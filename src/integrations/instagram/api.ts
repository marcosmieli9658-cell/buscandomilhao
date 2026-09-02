import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { leads, messages, systemSettings } from "@/db/schema";
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

export async function sendInstagramApiMessage(leadId: number, body: string) {
  const env = requireApiEnvironment();
  const settings = database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  if (settings?.globallyPaused) throw new Error("System is paused by the operator.");
  const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  if (lead.doNotContact) throw new Error("Lead is on the permanent do-not-contact list.");
  if (lead.channelOwner !== "api" || lead.channelState !== "api_active") throw new Error("The official API does not own this conversation.");
  if (!lead.instagramScopedId || !lead.lastInboundAt) throw new Error("Recipient is not eligible for official API messaging.");
  if (Date.now() - lead.lastInboundAt.getTime() > 24 * 60 * 60_000) throw new Error("The approved messaging window has expired.");

  const dedupeKey = crypto.createHash("sha256").update(`api:${leadId}:${body}:${lead.lastInboundAt.getTime()}`).digest("hex");
  if (env.DRY_RUN) {
    const now = new Date();
    database.db.insert(messages).values({ leadId, direction: "outbound", channel: "api", body, deliveryState: "dry_run", dedupeKey: `dry_run:${dedupeKey}`, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    return { message_id: undefined, dry_run: true };
  }
  if (database.sqlite.prepare("SELECT id FROM messages WHERE dedupe_key = ?").get(dedupeKey)) throw new Error("Duplicate API message blocked.");
  const response = await fetch(`https://graph.instagram.com/${env.INSTAGRAM_GRAPH_VERSION}/${env.INSTAGRAM_BUSINESS_ACCOUNT_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: lead.instagramScopedId }, message: { text: body } }),
  });
  const payload = await response.json() as { message_id?: string; error?: { message?: string } };
  if (!response.ok || !payload.message_id) throw new Error(`Instagram API send failed: ${payload.error?.message ?? response.status}`);
  const now = new Date();
  database.db.insert(messages).values({ leadId, externalId: payload.message_id, direction: "outbound", channel: "api", body, deliveryState: "sent", dedupeKey, sentAt: now, createdAt: now, updatedAt: now }).run();
  database.db.update(leads).set({ lastOutboundAt: now, updatedAt: now }).where(eq(leads.id, leadId)).run();
  return { ...payload, dry_run: false };
}
