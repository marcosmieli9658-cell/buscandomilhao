import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { leads, messages, systemSettings } from "@/db/schema";
import { createMessageDraft } from "@/features/approvals/service";
import { processInstagramWebhook } from "@/integrations/instagram/webhook";
import * as api from "@/integrations/instagram/api";
import * as environment from "@/lib/env";
import * as queue from "@/worker/queue";
import { POST } from "@/app/api/instagram/webhook/route";

type Incoming = { sender: { id: string; username?: string }; timestamp?: number; message: { mid: string; text?: string; attachments?: Array<{ type: string; payload: { url: string } }> } };
function incoming(mid = "original-event", timestamp: number | undefined = Date.now() - 1000): Incoming {
  return { sender: { id: "test-scoped", username: "test_durable" }, timestamp, message: { mid, text: "Olá, pode explicar?" } };
}
function payload(...items: Incoming[]) { return JSON.stringify({ object: "instagram", entry: [{ messaging: items }] }); }
function row() { return database.db.select().from(leads).get()!; }

beforeEach(() => {
  vi.restoreAllMocks();
  database.sqlite.exec(`DELETE FROM browser_artifacts; DELETE FROM exceptions; DELETE FROM webhook_events;
    DELETE FROM experiment_assignments; DELETE FROM experiment_variants; DELETE FROM experiments;
    DELETE FROM message_approvals; DELETE FROM ai_calls; DELETE FROM audit_logs; DELETE FROM events;
    DELETE FROM jobs; DELETE FROM messages; DELETE FROM leads; DELETE FROM system_settings;`);
  database.db.insert(systemSettings).values({ id: 1, globallyPaused: true, browserQueuePaused: true }).run();
});

describe("durable inbound replay", () => {
  it("keeps delayed original timestamps and cannot create a new reply window", async () => {
    const old = Date.now() - 6 * 24 * 60 * 60_000;
    expect(await processInstagramWebhook(payload(incoming("delayed", old)))).toEqual({ received: 1, duplicates: 0 });
    expect(row().lastInboundAt?.getTime()).toBe(old);
    expect(database.db.select().from(messages).get()?.sentAt?.getTime()).toBe(old);
    expect(() => createMessageDraft({ leadId: row().id, channel: "api", purpose: "reply", body: "Rascunho" })).toThrow(/expired/);
    expect(database.sqlite.prepare("SELECT globally_paused,browser_queue_paused FROM system_settings").get()).toEqual({ globally_paused: 1, browser_queue_paused: 1 });
    expect(database.sqlite.prepare("SELECT type,status,attempts FROM jobs").all()).toEqual([{ type: "process_inbound", status: "pending", attempts: 0 }]);
  });

  it("does not regress the reply window when events arrive out of order", async () => {
    const newest = Date.now() - 1000;
    await processInstagramWebhook(payload(incoming("newer", newest)));
    await processInstagramWebhook(payload(incoming("older", newest - 3 * 86400_000)));
    expect(row().lastInboundAt?.getTime()).toBe(newest);
    expect(database.db.select().from(messages).all()).toHaveLength(2);
  });

  it.each([undefined, 0, -1, NaN, Date.now() + 3600_000])("retains invalid original timestamps (%s) without inventing receipt time", async (timestamp) => {
    const item = incoming(); item.timestamp = timestamp;
    expect(await processInstagramWebhook(payload(item))).toEqual({ received: 0, duplicates: 0, failed: 1 });
    expect(database.db.select().from(messages).all()).toHaveLength(0);
    expect(database.db.select().from(leads).all()).toHaveLength(0);
    expect(database.sqlite.prepare("SELECT processed_at FROM webhook_events").get()).toEqual({ processed_at: null });
  });

  it("retries a failed profile lookup rather than treating a recorded event as processed", async () => {
    const item = incoming(); delete item.sender.username;
    const profile = vi.spyOn(api, "getInstagramProfile").mockRejectedValueOnce(new Error("failed token=do-not-record"))
      .mockResolvedValue({ id: "test-scoped", username: "test_durable" });
    expect(await processInstagramWebhook(payload(item))).toEqual({ received: 0, duplicates: 0, failed: 1 });
    expect(await processInstagramWebhook(payload(item))).toEqual({ received: 1, duplicates: 0 });
    expect(await processInstagramWebhook(payload(item))).toEqual({ received: 0, duplicates: 1 });
    expect(profile).toHaveBeenCalledTimes(2);
    expect(database.db.select().from(messages).all()).toHaveLength(1);
    expect(database.sqlite.prepare("SELECT processing_error FROM webhook_events").get()).toEqual({ processing_error: null });
    expect(database.sqlite.prepare("SELECT status,message FROM exceptions").get()).toEqual({ status: "resolved", message: "Instagram webhook processing failed; retained for retry." });
  });

  it("rolls back partial persistence and successfully replays the failed member of a batch", async () => {
    const enqueue = vi.spyOn(queue, "enqueueJob").mockImplementationOnce(() => { throw new Error("injected transaction failure"); });
    const input = payload(incoming("batch-a"), incoming("batch-b"));
    expect(await processInstagramWebhook(input)).toEqual({ received: 1, duplicates: 0, failed: 1 });
    expect(database.db.select().from(messages).all().map((m) => m.externalId)).toEqual(["batch-b"]);
    enqueue.mockRestore();
    expect(await processInstagramWebhook(input)).toEqual({ received: 1, duplicates: 1 });
    expect(database.db.select().from(messages).all()).toHaveLength(2);
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM jobs WHERE type='process_inbound'").get()).toEqual({ n: 2 });
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM webhook_events WHERE processed_at IS NULL OR processing_error IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("recovers a legacy partial message without duplication", async () => {
    const item = incoming();
    await processInstagramWebhook(payload(item));
    database.sqlite.prepare("UPDATE webhook_events SET processed_at=NULL, processing_error='old failure'").run();
    database.sqlite.prepare("DELETE FROM jobs").run();
    expect(await processInstagramWebhook(payload(item))).toEqual({ received: 1, duplicates: 0 });
    expect(database.db.select().from(messages).all()).toHaveLength(1);
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM events WHERE type='instagram_reply_received'").get()).toEqual({ n: 1 });
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 1 });
  });

  it.each(["blocked", "human_review_required", "do_not_contact"] as const)("preserves protected ownership %s during a late replay", async (state) => {
    await processInstagramWebhook(payload(incoming("first")));
    database.db.update(leads).set({ channelState: state, channelOwner: state === "human_review_required" ? "human" : "none", doNotContact: state === "do_not_contact" }).where(eq(leads.id, row().id)).run();
    database.sqlite.prepare("DELETE FROM jobs").run();
    expect(await processInstagramWebhook(payload(incoming("later")))).toEqual({ received: 1, duplicates: 0 });
    expect(row().channelState).toBe(state);
    expect(row().channelOwner).toBe(state === "human_review_required" ? "human" : "none");
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 });
  });

  it("returns HTTP 503 on partial failure and the compatible empty success shape", async () => {
    const secret = "test-hmac-secret";
    const env = environment.getEnv();
    vi.spyOn(environment, "getEnv").mockReturnValue({ ...env, INSTAGRAM_APP_SECRET: secret, INSTAGRAM_PRODUCT_APP_SECRET: undefined });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    async function post(raw: string) {
      const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
      return POST(new NextRequest("http://localhost:3000/api/instagram/webhook", { method: "POST", headers: { "x-hub-signature-256": signature, "content-type": "application/json" }, body: raw }));
    }
    const invalid = incoming(); delete invalid.timestamp;
    const failed = await post(payload(invalid, incoming("valid")));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, received: 1, duplicates: 0, failed: 1 });
    const empty = await post(payload());
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ok: true, received: 0, duplicates: 0 });
  });

  it("persists an audio placeholder and original metadata for human review without downloading or queuing a reply", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const item = incoming("audio-event", Date.now() - 2 * 86400_000);
    delete item.message.text;
    item.message.attachments = [{ type: "audio", payload: { url: "https://never-download.example/voice.mp4" } }];
    expect(await processInstagramWebhook(payload(item))).toEqual({ received: 1, duplicates: 0 });
    expect(await processInstagramWebhook(payload(item))).toEqual({ received: 0, duplicates: 1 });
    const stored = database.db.select().from(messages).get()!;
    expect(stored.body).toBe("[Mensagem com anexo recebida no Instagram. Consulte o Direct.]");
    expect(stored.externalId).toBe("audio-event");
    expect(stored.sentAt?.getTime()).toBe(item.timestamp);
    expect(JSON.parse(stored.metadataJson)).toEqual({ hasAttachments: true, attachmentCount: 1, requiresHumanReview: true });
    const source = database.sqlite.prepare("SELECT payload_json,processed_at FROM webhook_events").get() as { payload_json: string; processed_at: number };
    expect(JSON.parse(source.payload_json).message.attachments).toEqual(item.message.attachments);
    expect(source.processed_at).toBeGreaterThan(0);
    expect(row().channelState).toBe("human_review_required");
    expect(row().channelOwner).toBe("human");
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 });
    expect(network).not.toHaveBeenCalled();
  });

  it("preserves an opt-out when an attachment follows it", async () => {
    const first = incoming("opt-out"); first.message.text = "Pare de mandar mensagem";
    await processInstagramWebhook(payload(first));
    const second = incoming("attachment-after-opt-out"); delete second.message.text;
    second.message.attachments = [{ type: "image", payload: { url: "https://never-download.example/image" } }];
    expect(await processInstagramWebhook(payload(second))).toEqual({ received: 1, duplicates: 0 });
    expect(row().doNotContact).toBe(true);
    expect(row().channelState).toBe("do_not_contact");
    expect(row().channelOwner).toBe("none");
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 });
  });
});
