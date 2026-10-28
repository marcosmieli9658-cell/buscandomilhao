import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { events, leads, messages } from "@/db/schema";
import { discoverLead, markDoNotContact, normalizeInstagramHandle, transitionChannel, transitionPipeline } from "@/features/leads/service";
import { enqueueJob } from "@/worker/queue";
import { getInstagramProfile } from "./api";

interface MessagingEvent {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ type?: string; payload?: unknown }> };
}

interface WebhookPayload {
  object?: string;
  entry?: Array<{ id?: string; time?: number; messaging?: MessagingEvent[] }>;
}

function flattenMessages(payload: WebhookPayload): MessagingEvent[] {
  return payload.entry?.flatMap((entry) => entry.messaging ?? []) ?? [];
}

async function resolveLead(event: MessagingEvent) {
  const scopedId = event.sender?.id;
  if (!scopedId) throw new Error("Inbound webhook has no sender ID.");
  const byScopedId = database.db.select().from(leads).where(eq(leads.instagramScopedId, scopedId)).get();
  if (byScopedId) return byScopedId;
  const profile = event.sender?.username ? { username: event.sender.username } : await getInstagramProfile(scopedId);
  if (!profile.username) throw new Error("Could not resolve sender username from the official API.");
  const handle = normalizeInstagramHandle(profile.username);
  const byHandle = database.db.select().from(leads).where(eq(leads.instagramHandle, handle)).get();
  if (byHandle) {
    database.db.update(leads).set({ instagramScopedId: scopedId, updatedAt: new Date() }).where(eq(leads.id, byHandle.id)).run();
    return { ...byHandle, instagramScopedId: scopedId };
  }
  const discovered = discoverLead({ funnel: "client", instagramHandle: handle, displayName: "name" in profile ? profile.name : undefined, source: "instagram_inbound", score: 70, metadata: { scopedId } });
  database.db.update(leads).set({ instagramScopedId: scopedId, updatedAt: new Date() }).where(eq(leads.id, discovered.lead.id)).run();
  return { ...discovered.lead, instagramScopedId: scopedId };
}

function advancePipelineToReplied(leadId: number, currentState: string): void {
  const path = ["discovered", "qualified", "contacted", "replied"] as const;
  const currentIndex = path.indexOf(currentState as (typeof path)[number]);
  if (currentIndex < 0 || currentState === "replied") return;
  for (let index = currentIndex + 1; index < path.length; index += 1) transitionPipeline(leadId, path[index], "webhook", "inbound Instagram message");
}

export function originalMessageTime(event: MessagingEvent, receivedAt = Date.now()): Date {
  const timestamp = event.timestamp;
  if (!Number.isSafeInteger(timestamp) || timestamp! <= 0 || timestamp! > receivedAt + 5 * 60_000) {
    throw new Error("Invalid original Instagram event timestamp.");
  }
  return new Date(timestamp!);
}

export async function processInstagramWebhook(rawBody: string): Promise<{ received: number; duplicates: number; failed?: number }> {
  const payload = JSON.parse(rawBody) as WebhookPayload;
  const incoming = flattenMessages(payload).filter((event) => event.message && !event.message.is_echo &&
    ((typeof event.message.text === "string" && event.message.text.length > 0)
      || (Array.isArray(event.message.attachments) && event.message.attachments.length > 0)));
  let received = 0;
  let duplicates = 0;
  let failed = 0;
  for (const event of incoming) {
    const externalId = event.message?.mid ?? crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
    database.sqlite.prepare(`
      INSERT INTO webhook_events (external_id, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING
    `).run(externalId, JSON.stringify(event), Date.now(), Date.now());
    const stored = database.sqlite.prepare("SELECT processed_at FROM webhook_events WHERE external_id = ?").get(externalId) as { processed_at: number | null };
    if (stored.processed_at !== null) { duplicates += 1; continue; }
    try {
      // Receipt time must never create a fresh reply window for a delayed event.
      const originalTime = originalMessageTime(event);
      const lead = await resolveLead(event);
      const hasAttachments = Boolean(event.message?.attachments?.length);
      const text = typeof event.message?.text === "string" ? event.message.text : "";
      const body = hasAttachments
        ? `${text ? `${text}\n\n` : ""}[Mensagem com anexo recebida no Instagram. Consulte o Direct.]`
        : text;
      const processed = database.sqlite.transaction(() => {
        // Another request may have completed while the profile lookup was awaiting.
        const latest = database.sqlite.prepare("SELECT processed_at FROM webhook_events WHERE external_id = ?").get(externalId) as { processed_at: number | null };
        if (latest.processed_at !== null) return false;
        const current = database.db.select().from(leads).where(eq(leads.id, lead.id)).get()!;
        const previous = database.db.select().from(messages).where(eq(messages.externalId, externalId)).get();
        if (previous && (previous.leadId !== lead.id || previous.direction !== "inbound" || previous.body !== body)) throw new Error("Instagram event identity conflict.");
        // Recover partial events left by the former handler without a second message.
        if (!previous) {
          database.db.insert(messages).values({ leadId: lead.id, externalId, direction: "inbound", channel: "api", body, deliveryState: "delivered", dedupeKey: `webhook:${externalId}`,
            metadataJson: hasAttachments ? JSON.stringify({ hasAttachments: true, attachmentCount: event.message!.attachments!.length, requiresHumanReview: true }) : "{}",
            sentAt: originalTime, createdAt: originalTime, updatedAt: new Date() }).run();
        }
        const lastInboundAt = new Date(Math.max(current.lastInboundAt?.getTime() ?? 0, Math.min(originalTime.getTime(), Date.now())));
        database.db.update(leads).set({ lastInboundAt, updatedAt: new Date() }).where(eq(leads.id, lead.id)).run();
        const recorded = database.sqlite.prepare("SELECT id FROM events WHERE lead_id = ? AND type = 'instagram_reply_received' AND json_extract(payload_json, '$.externalId') = ?").get(lead.id, externalId);
        if (!recorded) database.db.insert(events).values({ leadId: lead.id, type: "instagram_reply_received", source: "webhook", payloadJson: JSON.stringify({ externalId }), occurredAt: originalTime, createdAt: new Date(), updatedAt: new Date() }).run();
        if (/\b(pare|parar|n[aã]o me (chame|mande)|remov[ae]|sair)\b/i.test(body)) {
          if (!current.doNotContact) markDoNotContact(lead.id, "Instagram opt-out", "webhook");
        } else if (hasAttachments) {
          if (!current.doNotContact && !["blocked", "do_not_contact", "completed"].includes(current.channelState)) {
            if (current.channelState !== "human_review_required") transitionChannel(lead.id, "human_review_required", "human", "webhook", "attachment requires review in Direct");
            advancePipelineToReplied(lead.id, current.pipelineState);
          }
        } else if (!current.doNotContact && current.channelOwner !== "human" && !["blocked", "do_not_contact", "completed", "human_review_required", "api_window_closed"].includes(current.channelState)) {
          if (current.channelState !== "api_active") {
            if (["browser_contact_pending", "waiting_inbound_reply"].includes(current.channelState)) transitionChannel(lead.id, "api_eligible", "api", "webhook", "verified inbound message");
            if (current.channelState === "browser_contact_sent") {
              transitionChannel(lead.id, "waiting_inbound_reply", "browser", "webhook", "inbound during first contact");
              transitionChannel(lead.id, "api_eligible", "api", "webhook", "verified inbound message");
            }
            transitionChannel(lead.id, "api_active", "api", "webhook", "official API handoff");
          }
          advancePipelineToReplied(lead.id, current.pipelineState);
          enqueueJob("process_inbound", { leadId: lead.id, externalId }, { dedupeKey: `process_inbound:${externalId}` });
        }
        database.sqlite.prepare("UPDATE webhook_events SET processed_at = ?, processing_error = NULL, updated_at = ? WHERE external_id = ?").run(Date.now(), Date.now(), externalId);
        database.sqlite.prepare("UPDATE exceptions SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE code = 'webhook_processing_failed' AND status = 'open' AND json_extract(details_json, '$.externalId') = ?").run(Date.now(), Date.now(), externalId);
        return true;
      }).immediate();
      if (processed) received += 1;
      else duplicates += 1;
    } catch (error) {
      const completed = database.sqlite.prepare("SELECT processed_at FROM webhook_events WHERE external_id = ?").get(externalId) as { processed_at: number | null };
      if (completed.processed_at !== null) { duplicates += 1; continue; }
      failed += 1;
      // Avoid storing tokens or response bodies from a failed profile API request.
      const message = error instanceof Error && error.message === "Invalid original Instagram event timestamp."
        ? error.message : "Instagram webhook processing failed; retained for retry.";
      database.sqlite.prepare("UPDATE webhook_events SET processing_error = ?, updated_at = ? WHERE external_id = ?").run(message, Date.now(), externalId);
      database.sqlite.prepare(`INSERT INTO exceptions (code, message, details_json, status, created_at, updated_at)
        SELECT 'webhook_processing_failed', ?, ?, 'open', ?, ? WHERE NOT EXISTS
        (SELECT 1 FROM exceptions WHERE code = 'webhook_processing_failed' AND status = 'open' AND json_extract(details_json, '$.externalId') = ?)`)
        .run(message, JSON.stringify({ externalId }), Date.now(), Date.now(), externalId);
    }
  }
  return failed ? { received, duplicates, failed } : { received, duplicates };
}
