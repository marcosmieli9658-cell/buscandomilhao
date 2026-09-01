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
  message?: { mid?: string; text?: string; is_echo?: boolean };
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

export async function processInstagramWebhook(rawBody: string): Promise<{ received: number; duplicates: number }> {
  const payload = JSON.parse(rawBody) as WebhookPayload;
  const incoming = flattenMessages(payload).filter((event) => event.message?.text && !event.message.is_echo);
  let received = 0;
  let duplicates = 0;
  for (const event of incoming) {
    const externalId = event.message?.mid ?? crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");
    const webhookInsert = database.sqlite.prepare(`
      INSERT INTO webhook_events (external_id, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(external_id) DO NOTHING
    `).run(externalId, JSON.stringify(event), Date.now(), Date.now());
    if (!webhookInsert.changes) { duplicates += 1; continue; }
    try {
      const lead = await resolveLead(event);
      const body = event.message!.text!;
      const now = new Date(event.timestamp ?? Date.now());
      database.db.transaction((tx) => {
        tx.insert(messages).values({ leadId: lead.id, externalId, direction: "inbound", channel: "api", body, deliveryState: "delivered", dedupeKey: `webhook:${externalId}`, sentAt: now, createdAt: now, updatedAt: now }).run();
        tx.update(leads).set({ lastInboundAt: now, updatedAt: new Date() }).where(eq(leads.id, lead.id)).run();
        tx.insert(events).values({ leadId: lead.id, type: "instagram_reply_received", source: "webhook", payloadJson: JSON.stringify({ externalId }), occurredAt: now, createdAt: new Date(), updatedAt: new Date() }).run();
      });
      if (lead.channelState !== "api_active") {
        if (["browser_contact_pending", "waiting_inbound_reply"].includes(lead.channelState)) transitionChannel(lead.id, "api_eligible", "api", "webhook", "verified inbound message");
        transitionChannel(lead.id, "api_active", "api", "webhook", "official API handoff");
      }
      advancePipelineToReplied(lead.id, lead.pipelineState);
      if (/\b(pare|parar|n[aã]o me (chame|mande)|remov[ae]|sair)\b/i.test(body)) {
        markDoNotContact(lead.id, "Instagram opt-out", "webhook");
      } else {
        enqueueJob("process_inbound", { leadId: lead.id, externalId }, { dedupeKey: `process_inbound:${externalId}` });
      }
      database.sqlite.prepare("UPDATE webhook_events SET processed_at = ?, updated_at = ? WHERE external_id = ?").run(Date.now(), Date.now(), externalId);
      received += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      database.sqlite.prepare("UPDATE webhook_events SET processing_error = ?, updated_at = ? WHERE external_id = ?").run(message, Date.now(), externalId);
      database.sqlite.prepare(`INSERT INTO exceptions (code, message, details_json, status, created_at, updated_at) VALUES ('webhook_processing_failed', ?, ?, 'open', ?, ?)`)
        .run(message, JSON.stringify({ externalId }), Date.now(), Date.now());
    }
  }
  return { received, duplicates };
}
