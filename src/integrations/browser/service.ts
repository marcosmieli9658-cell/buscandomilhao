import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { events, exceptions, jobs, leads, messageApprovals, messages, systemSettings } from "@/db/schema";
import { transitionChannel, transitionPipeline } from "@/features/leads/service";
import { assertFirstContactEligible, claimMessageApproval, finishMessageApproval } from "@/features/approvals/service";
import { getEnv } from "@/lib/env";
import { BrowserSendDeferredError, getZonedTimeParts, nextOperatingTime } from "./scheduling";
export { nextBrowserSendAt } from "./scheduling";
import { instagramRequestsDisabledErrors, type BrowserGateway } from "./gateway";

export function assertOperatingLimits(now = new Date()): void {
  const env = getEnv();
  const settings = database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  if (settings?.globallyPaused) throw new Error(`System is paused: ${settings.pauseReason ?? "operator"}.`);
  if (settings?.browserQueuePaused) throw new Error(`Browser queue is paused: ${settings.browserPauseReason ?? "integration alert"}.`);
  const parts = getZonedTimeParts(now, env.OPERATING_TIMEZONE);
  const weekdayNumbers: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const allowedDays = env.OPERATING_DAYS.split(",").map(Number);
  if (!allowedDays.includes(weekdayNumbers[parts.weekday])) throw new BrowserSendDeferredError(`Outside approved operating days (${env.OPERATING_DAYS}).`, nextOperatingTime(now));
  const current = `${parts.hour}:${parts.minute}`;
  const [start, end] = env.OPERATING_HOURS.split("-");
  if (current < start || current > end) throw new BrowserSendDeferredError(`Outside approved operating hours (${env.OPERATING_HOURS}).`, nextOperatingTime(now));

  const dayStart = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00-03:00`).getTime();
  const sentToday = database.sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel = 'browser' AND delivery_state = 'sent' AND sent_at >= ?").get(dayStart) as { count: number };
  if (sentToday.count >= env.MAX_DMS_PER_DAY) throw new BrowserSendDeferredError(`Daily browser DM limit reached (${env.MAX_DMS_PER_DAY}).`, nextOperatingTime(new Date(now.getTime() + 24 * 60 * 60_000)));

  const last = database.sqlite.prepare("SELECT MAX(sent_at) AS last_sent FROM messages WHERE channel = 'browser' AND delivery_state = 'sent'").get() as { last_sent: number | null };
  if (last.last_sent) {
    const minimumGap = env.MIN_SECONDS_BETWEEN_DMS * 1000;
    if (now.getTime() - last.last_sent < minimumGap) throw new BrowserSendDeferredError("Minimum interval between DMs has not elapsed.", nextOperatingTime(new Date(last.last_sent + minimumGap)));
  }
}

function reschedulePendingBrowserContacts(sentAt: Date): void {
  const minimumGap = getEnv().MIN_SECONDS_BETWEEN_DMS * 1000;
  const queued = database.sqlite.prepare(`
    SELECT id, run_at FROM jobs
    WHERE type IN ('send_browser_dm', 'send_approved_browser') AND status IN ('pending', 'retry')
    ORDER BY run_at ASC, id ASC
  `).all() as Array<{ id: number; run_at: number }>;
  let nextAllowedAt = sentAt.getTime() + minimumGap;
  const update = database.sqlite.prepare("UPDATE jobs SET run_at = ?, updated_at = ? WHERE id = ?");

  database.sqlite.transaction(() => {
    for (const job of queued) {
      const scheduledAt = Math.max(job.run_at, nextAllowedAt);
      if (scheduledAt !== job.run_at) update.run(scheduledAt, Date.now(), job.id);
      nextAllowedAt = scheduledAt + minimumGap;
    }
  })();
}

function prepareFirstContact(jobId: number, leadId: number, body: string, dryRun: boolean, approvalId?: number) {
  return database.sqlite.transaction(() => {
    assertOperatingLimits();
    assertFirstContactEligible(leadId, jobId);
    const approval = claimMessageApproval({ id: approvalId, leadId, channel: "browser", body });
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get()!;
    const handle = approval.recipientHandle;
    const hash = crypto.createHash("sha256").update(`first_dm:${leadId}`).digest("hex");
    const dedupeKey = `${dryRun ? "dry_run" : "reserved"}:${hash}`;
    const metadata = { jobId, instagramHandle: handle, instagramScopedId: lead.instagramScopedId, firstContactAttempt: "reserved", approvalId: approval.id };
    const reservation = dryRun ? null : database.db.insert(messages).values({
      leadId, direction: "outbound", channel: "browser", body, deliveryState: "planned", dedupeKey,
      metadataJson: JSON.stringify(metadata), createdAt: new Date(), updatedAt: new Date(),
    }).returning({ id: messages.id }).get();
    return { lead, dedupeKey, metadata, reservation, approval };
  }).immediate();
}

export async function sendFirstContact(jobId: number, leadId: number, body: string, gateway: BrowserGateway, dryRun = getEnv().DRY_RUN, approvalId?: number) {
  dryRun = dryRun || getEnv().DRY_RUN;
  const { lead, dedupeKey, metadata, reservation, approval } = prepareFirstContact(jobId, leadId, body, dryRun, approvalId);
  try {
    const result = await gateway.sendFirstMessage({ jobId, handle: lead.instagramHandle, message: approval.body, dryRun });
    if (result.blocked) {
      if (dryRun || result.sent || result.dryRun || !reservation || result.blocked.reasonCode !== "instagram_new_message_requests_disabled"
        || !instagramRequestsDisabledErrors.includes(result.blocked.observedError) || !result.blocked.proofPath || !/^[a-f0-9]{64}$/.test(result.blocked.proofSha256)) {
        throw new Error("Invalid platform rejection result. Reservation retained for manual review.");
      }
      const now = new Date();
      const reason = "Instagram recusou a solicitação: o perfil não aceita novas mensagens de todos. Tentativa bloqueada, sem repetição automática.";
      database.db.transaction((tx) => {
        const evidence = { ...result.blocked!, threadUrl: result.url, jobId, approvalId: approval.id };
        tx.update(messages).set({ deliveryState: "blocked", metadataJson: JSON.stringify({ ...metadata, firstContactAttempt: "platform_blocked", platformBlock: evidence }), updatedAt: now })
          .where(eq(messages.id, reservation.id)).run();
        tx.update(messageApprovals).set({ status: "rejected", version: approval.version + 1, updatedAt: now })
          .where(eq(messageApprovals.id, approval.id)).run();
        // The writes above hold the transaction's lock. Preserve any newer inbound/human handoff,
        // while the blocked message still prevents another first-contact attempt for this identity.
        const current = tx.select().from(leads).where(eq(leads.id, leadId)).get();
        if (current && current.channelOwner === "browser" && current.channelState === "browser_contact_pending" && !current.lastInboundAt && !current.doNotContact) {
          // A platform restriction is not an opt-out. Keep doNotContact unchanged.
          tx.update(leads).set({ channelState: "blocked", channelOwner: "none", pipelineState: "closed", nextActionAt: null, version: current.version + 1, updatedAt: now })
            .where(eq(leads.id, leadId)).run();
        }
        tx.update(jobs).set({ status: "dead_letter", lastError: reason, lockedAt: null, lockedBy: null, updatedAt: now }).where(eq(jobs.id, jobId)).run();
        tx.insert(events).values({ leadId, type: "browser_dm_platform_blocked", source: "browser", payloadJson: JSON.stringify(evidence), occurredAt: now, createdAt: now, updatedAt: now }).run();
        tx.insert(exceptions).values({ leadId, jobId, code: result.blocked!.reasonCode, message: reason, detailsJson: JSON.stringify(evidence), status: "resolved", resolvedAt: now, createdAt: now, updatedAt: now }).run();
      });
      return result;
    }
    if (!dryRun && (!result.sent || result.dryRun)) throw new Error("Browser send was not confirmed. Reservation retained for manual review.");
    if (dryRun && (result.sent || !result.dryRun)) throw new Error("Unexpected browser result during simulation. Manual review required.");
    const now = new Date();
    database.db.transaction((tx) => {
      if (reservation) {
        tx.update(messages).set({ deliveryState: "sent", metadataJson: JSON.stringify({ ...metadata, firstContactAttempt: "confirmed", url: result.url }), sentAt: now, updatedAt: now }).where(eq(messages.id, reservation.id)).run();
      } else {
        tx.insert(messages).values({ leadId, direction: "outbound", channel: "browser", body: approval.body, deliveryState: "dry_run", dedupeKey, metadataJson: JSON.stringify({ url: result.url, approvalId: approval.id }), createdAt: now, updatedAt: now }).onConflictDoNothing().run();
      }
      tx.insert(events).values({ leadId, type: result.dryRun ? "browser_dm_dry_run" : "browser_dm_sent", source: "browser", payloadJson: JSON.stringify({ jobId, approvalId: approval.id }), occurredAt: now, createdAt: now, updatedAt: now }).run();
      finishMessageApproval(approval.id, result.dryRun ? "simulated" : "sent");
    });
    if (result.sent) {
      reschedulePendingBrowserContacts(now);
      database.sqlite.transaction(() => {
        // Inbound may have handed the conversation to the API while the gateway awaited confirmation.
        // Read under the write lock; never replay the pre-send browser state over that newer state.
        const current = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
        if (!current || current.channelOwner !== "browser" || current.channelState !== "browser_contact_pending" || current.lastInboundAt) return;
        transitionChannel(leadId, "browser_contact_sent", "browser", "browser", "first DM sent");
        transitionChannel(leadId, "waiting_inbound_reply", "browser", "browser", "waiting for reply");
        if (current.pipelineState === "discovered") transitionPipeline(leadId, "qualified", "browser", "operator-approved first contact");
        if (["discovered", "qualified"].includes(current.pipelineState)) transitionPipeline(leadId, "contacted", "browser", "first DM sent");
      }).immediate();
    }
    return result;
  } catch (error) {
    finishMessageApproval(approval.id, "uncertain");
    throw error;
  }
}
