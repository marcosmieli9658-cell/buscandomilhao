import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { leads, messages, systemSettings } from "@/db/schema";
import { claimMessageApproval, finishMessageApproval } from "@/features/approvals/service";
import { getEnv } from "@/lib/env";

interface InstagramProfile { id: string; username?: string; name?: string }

function requireApiEnvironment() {
  const env = getEnv();
  if (!env.INSTAGRAM_PAGE_ACCESS_TOKEN || !env.INSTAGRAM_BUSINESS_ACCOUNT_ID) {
    throw new Error("Instagram messaging API credentials are not configured.");
  }
  return env;
}

export async function getInstagramProfile(scopedId: string): Promise<InstagramProfile> {
  const env = requireApiEnvironment();
  const url = new URL(`https://graph.instagram.com/${env.INSTAGRAM_GRAPH_VERSION}/${encodeURIComponent(scopedId)}`);
  url.searchParams.set("fields", "id,username,name");
  url.searchParams.set("access_token", env.INSTAGRAM_PAGE_ACCESS_TOKEN!);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Instagram profile lookup failed with ${response.status}.`);
  return response.json() as Promise<InstagramProfile>;
}

export async function sendInstagramApiMessage(leadId: number, body: string, approvalId?: number) {
  const env = requireApiEnvironment();
  const prepared = database.sqlite.transaction(() => {
    const settings = database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
    if (settings?.globallyPaused) throw new Error("System is paused by the operator.");
    const approval = claimMessageApproval({ id: approvalId, leadId, channel: "api", body });
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get()!;
    const dedupeKey = crypto.createHash("sha256").update(`api:${leadId}:${approval.body}:${lead.lastInboundAt!.getTime()}`).digest("hex");
    if (database.sqlite.prepare("SELECT id FROM messages WHERE dedupe_key = ?").get(dedupeKey)) throw new Error("Duplicate API message blocked.");
    const reservation = database.db.insert(messages).values({ leadId, direction: "outbound", channel: "api", body: approval.body,
      deliveryState: env.DRY_RUN ? "dry_run" : "planned", dedupeKey: env.DRY_RUN ? `dry_run:${approval.id}:${dedupeKey}` : dedupeKey,
      metadataJson: JSON.stringify({ approvalId: approval.id, instagramHandle: approval.recipientHandle, instagramScopedId: approval.recipientScopedId }) }).returning().get();
    if (env.DRY_RUN) finishMessageApproval(approval.id, "simulated");
    return { approval, lead, reservation };
  }).immediate();
  if (env.DRY_RUN) return { message_id: undefined, dry_run: true };
  try {
    const response = await fetch(`https://graph.instagram.com/${env.INSTAGRAM_GRAPH_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: prepared.approval.recipientScopedId }, message: { text: prepared.approval.body } }),
    });
    const payload = await response.json() as { message_id?: string; error?: { message?: string } };
    if (!response.ok || !payload.message_id) throw new Error(`Instagram API send failed: ${payload.error?.message ?? response.status}`);
    const now = new Date();
    database.db.transaction((tx) => {
      tx.update(messages).set({ externalId: payload.message_id, deliveryState: "sent", sentAt: now, updatedAt: now }).where(eq(messages.id, prepared.reservation.id)).run();
      tx.update(leads).set({ lastOutboundAt: now, updatedAt: now }).where(eq(leads.id, leadId)).run();
      finishMessageApproval(prepared.approval.id, "sent");
    });
    return { ...payload, dry_run: false };
  } catch (error) {
    finishMessageApproval(prepared.approval.id, "uncertain");
    throw error;
  }
}
