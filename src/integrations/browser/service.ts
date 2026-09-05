import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { events, leads, messages, systemSettings } from "@/db/schema";
import { transitionChannel, transitionPipeline } from "@/features/leads/service";
import { getEnv } from "@/lib/env";
import type { BrowserGateway } from "./gateway";

function getZonedTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function assertOperatingLimits(now = new Date()): void {
  const env = getEnv();
  const settings = database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  if (settings?.globallyPaused) throw new Error(`System is paused: ${settings.pauseReason ?? "operator"}.`);
  if (settings?.browserQueuePaused) throw new Error(`Browser queue is paused: ${settings.browserPauseReason ?? "integration alert"}.`);
  const parts = getZonedTimeParts(now, env.OPERATING_TIMEZONE);
  const weekdayNumbers: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const allowedDays = env.OPERATING_DAYS.split(",").map(Number);
  if (!allowedDays.includes(weekdayNumbers[parts.weekday])) throw new Error(`Outside approved operating days (${env.OPERATING_DAYS}).`);
  const current = `${parts.hour}:${parts.minute}`;
  const [start, end] = env.OPERATING_HOURS.split("-");
  if (current < start || current > end) throw new Error(`Outside approved operating hours (${env.OPERATING_HOURS}).`);

  const dayStart = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00-03:00`).getTime();
  const sentToday = database.sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE channel = 'browser' AND delivery_state = 'sent' AND sent_at >= ?").get(dayStart) as { count: number };
  if (sentToday.count >= env.MAX_DMS_PER_DAY) throw new Error(`Daily browser DM limit reached (${env.MAX_DMS_PER_DAY}).`);

  const last = database.sqlite.prepare("SELECT MAX(sent_at) AS last_sent FROM messages WHERE channel = 'browser' AND delivery_state = 'sent'").get() as { last_sent: number | null };
  if (last.last_sent) {
    const minimumGap = env.MIN_SECONDS_BETWEEN_DMS * 1000;
    if (now.getTime() - last.last_sent < minimumGap) throw new Error("Minimum interval between DMs has not elapsed.");
  }
}

export function nextBrowserSendAt(now = new Date(), random = Math.random): Date {
  const env = getEnv();
  const lastSent = database.sqlite.prepare("SELECT MAX(sent_at) AS value FROM messages WHERE channel = 'browser' AND delivery_state = 'sent'").get() as { value: number | null };
  const lastScheduled = database.sqlite.prepare("SELECT MAX(run_at) AS value FROM jobs WHERE type = 'send_browser_dm' AND status IN ('pending', 'retry', 'running')").get() as { value: number | null };
  if (!lastSent.value && !lastScheduled.value) return now;

  const minimum = env.MIN_SECONDS_BETWEEN_DMS;
  const maximum = env.MAX_SECONDS_BETWEEN_DMS;
  const delaySeconds = Math.min(maximum, minimum + Math.floor(random() * (maximum - minimum + 1)));
  const baseline = lastScheduled.value
    ? Math.max(now.getTime(), lastScheduled.value, lastSent.value ?? 0)
    : Math.max(now.getTime() - delaySeconds * 1000, lastSent.value ?? 0);
  return new Date(baseline + delaySeconds * 1000);
}

export async function sendFirstContact(jobId: number, leadId: number, body: string, gateway: BrowserGateway, dryRun = getEnv().DRY_RUN) {
  assertOperatingLimits();
  const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  if (lead.doNotContact) throw new Error("Lead is on the permanent do-not-contact list.");
  if (lead.channelOwner !== "browser" || lead.channelState !== "browser_contact_pending") throw new Error("Browser does not own this conversation.");
  const dedupeKey = crypto.createHash("sha256").update(`first_dm:${leadId}`).digest("hex");
  const duplicate = database.sqlite.prepare("SELECT id FROM messages WHERE dedupe_key = ?").get(dedupeKey);
  if (duplicate) throw new Error("Duplicate first contact blocked.");

  const result = await gateway.sendFirstMessage({ jobId, handle: lead.instagramHandle, message: body, dryRun });
  const now = new Date();
  database.db.transaction((tx) => {
    tx.insert(messages).values({ leadId, direction: "outbound", channel: "browser", body, deliveryState: result.dryRun ? "dry_run" : "sent", dedupeKey, metadataJson: JSON.stringify({ url: result.url }), sentAt: result.sent ? now : null, createdAt: now, updatedAt: now }).run();
    tx.insert(events).values({ leadId, type: result.dryRun ? "browser_dm_dry_run" : "browser_dm_sent", source: "browser", payloadJson: JSON.stringify({ jobId }), occurredAt: now, createdAt: now, updatedAt: now }).run();
  });
  if (result.sent) {
    transitionChannel(leadId, "browser_contact_sent", "browser", "browser", "first DM sent");
    transitionChannel(leadId, "waiting_inbound_reply", "browser", "browser", "waiting for reply");
    if (lead.pipelineState === "qualified") transitionPipeline(leadId, "contacted", "browser", "first DM sent");
  }
  return result;
}
