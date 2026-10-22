import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { leads, messages, messageApprovals, systemSettings } from "@/db/schema";
import { approveMessageDraft, claimMessageApproval, createMessageDraft, getMessageDraft, rejectMessageDraft, saveMessageDraft } from "@/features/approvals/service";
import { sendFirstContact } from "@/integrations/browser/service";
import type { BrowserGateway } from "@/integrations/browser/gateway";
import { sendInstagramApiMessage } from "@/integrations/instagram/api";
import type { ConversationEngine } from "@/integrations/openai/engine";
import * as environment from "@/lib/env";
import { handleJob } from "@/worker/handlers";
import { claimNextJob, completeJob, recoverStaleJobs } from "@/worker/queue";
import { approvedFixture } from "./approval-fixtures";

const baseEnvironment = environment.getEnv();
const engine: ConversationEngine = {
  generateFirstContact: async () => ({ message: "Olá! Sou o Marcos, da Blessia Labs. Vocês já têm site?", variantReason: "Pergunta sobre site" }),
  decideNextAction: async () => ({ intention: "asked_info", action: "reply", message: "Podemos conversar sobre o site.", reasoningSummary: "Resposta ao interesse", claimIndices: [], followUpHours: null }),
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(environment, "getEnv").mockReturnValue({ ...baseEnvironment, DRY_RUN: false, INSTAGRAM_PAGE_ACCESS_TOKEN: "test-token", INSTAGRAM_BUSINESS_ACCOUNT_ID: "test-account" });
  database.sqlite.exec(`DELETE FROM browser_artifacts; DELETE FROM exceptions; DELETE FROM webhook_events;
    DELETE FROM experiment_assignments; DELETE FROM experiment_variants; DELETE FROM experiments;
    DELETE FROM message_approvals; DELETE FROM ai_calls; DELETE FROM audit_logs; DELETE FROM events;
    DELETE FROM jobs; DELETE FROM messages; DELETE FROM leads; DELETE FROM system_settings;`);
  database.db.insert(systemSettings).values({ id: 1 }).run();
});

function lead(channel: "browser" | "api" = "browser", handle = "@cliente_teste") {
  return database.db.insert(leads).values({ funnel: "client", instagramHandle: handle, source: "test", pipelineState: channel === "api" ? "replied" : "qualified",
    channelOwner: channel, channelState: channel === "api" ? "api_active" : "browser_contact_pending",
    instagramScopedId: channel === "api" ? `id-${handle}` : null, lastInboundAt: channel === "api" ? new Date() : null }).returning().get();
}

function browser() {
  return { sendFirstMessage: vi.fn<BrowserGateway["sendFirstMessage"]>(async (request) => ({ sent: !request.dryRun, dryRun: request.dryRun, url: "https://www.instagram.com/direct/t/test/" })) };
}

function draft(leadId: number, body = "Texto revisável") { return createMessageDraft({ leadId, body, channel: "browser", purpose: "first_contact" }); }

describe("human approval at every outbound boundary", () => {
  it.each(["generate_first_contact", "process_inbound", "follow_up"])("%s only creates a pending draft, with no send job or network call", async (type) => {
    const recipient = lead(type === "generate_first_contact" ? "browser" : "api");
    const gateway = browser();
    const network = vi.spyOn(globalThis, "fetch");
    await handleJob({ id: 100, type, payload: { leadId: recipient.id }, attempts: 1, maxAttempts: 3 }, { conversationEngine: engine, browserGateway: gateway });
    expect(database.db.select().from(messageApprovals).get()?.status).toBe("pending");
    expect(database.sqlite.prepare("SELECT count(*) n FROM jobs WHERE type LIKE 'send_%'").get()).toEqual({ n: 0 });
    expect(gateway.sendFirstMessage).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("blocks direct transport calls and legacy jobs without human approval", async () => {
    const recipient = lead();
    const apiRecipient = lead("api", "@outro");
    const gateway = browser();
    const network = vi.spyOn(globalThis, "fetch");
    await expect(sendFirstContact(1, recipient.id, "Texto", gateway, false)).rejects.toThrow(/aprovação humana/);
    await expect(sendInstagramApiMessage(apiRecipient.id, "Texto")).rejects.toThrow(/aprovação humana/);
    await expect(handleJob({ id: 1, type: "send_browser_dm", payload: { leadId: recipient.id, body: "Legada" }, attempts: 1, maxAttempts: 3 }, { conversationEngine: engine, browserGateway: gateway })).rejects.toThrow(/sem aprovação/);
    expect(gateway.sendFirstMessage).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("requires the saved version, nonempty body and checked Direct history; approval never releases pauses", () => {
    const recipient = lead();
    const empty = draft(recipient.id, "");
    expect(() => approveMessageDraft({ id: empty.id, expectedVersion: empty.version, directHistoryChecked: true })).toThrow(/1.000/);
    const saved = saveMessageDraft({ id: empty.id, expectedVersion: empty.version, body: "Texto final" });
    expect(() => approveMessageDraft({ id: saved.id, expectedVersion: empty.version, directHistoryChecked: true })).toThrow(/mudou/);
    expect(() => approveMessageDraft({ id: saved.id, expectedVersion: saved.version })).toThrow(/Direct/);
    database.db.update(systemSettings).set({ globallyPaused: true, browserQueuePaused: true }).where(eq(systemSettings.id, 1)).run();
    const approved = approveMessageDraft({ id: saved.id, expectedVersion: saved.version, directHistoryChecked: true });
    expect(approved.body).toBe("Texto final");
    expect(() => approveMessageDraft({ id: saved.id, expectedVersion: saved.version, directHistoryChecked: true })).toThrow(/mudou/);
    expect(database.sqlite.prepare("SELECT count(*) n FROM jobs").get()).toEqual({ n: 1 });
    expect(database.db.select().from(systemSettings).get()).toMatchObject({ globallyPaused: true, browserQueuePaused: true });
  });

  it("rejects stale edits, changed recipients and changed body at the transport", async () => {
    const recipient = lead();
    const original = draft(recipient.id);
    const saved = saveMessageDraft({ id: original.id, expectedVersion: original.version, body: "Texto exato" });
    expect(() => saveMessageDraft({ id: original.id, expectedVersion: original.version, body: "Perdida" })).toThrow(/mudou/);
    const approved = approveMessageDraft({ id: saved.id, expectedVersion: saved.version, directHistoryChecked: true });
    const gateway = browser();
    await expect(sendFirstContact(1, recipient.id, "Texto adulterado", gateway, false, approved.id)).rejects.toThrow(/alterada/);
    database.db.update(leads).set({ instagramHandle: "@destino_novo" }).where(eq(leads.id, recipient.id)).run();
    await expect(sendFirstContact(1, recipient.id, approved.body, gateway, false, approved.id)).rejects.toThrow(/destinatário mudou/);
    expect(gateway.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("rechecks contact history after approval and does not consume an approval on a blocked send", async () => {
    const recipient = lead();
    const approved = approvedFixture(recipient.id, "Texto", "browser");
    database.db.insert(messages).values({ leadId: recipient.id, direction: "outbound", channel: "human", deliveryState: "sent", body: "Manual", dedupeKey: "manual" }).run();
    const gateway = browser();
    await expect(sendFirstContact(1, recipient.id, approved.body, gateway, false, approved.id)).rejects.toThrow(/Contato anterior/);
    expect(getMessageDraft(approved.id).status).toBe("approved");
    expect(gateway.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("keeps rejected drafts and their already queued job from sending", async () => {
    const recipient = lead();
    const approved = approvedFixture(recipient.id, "Texto", "browser");
    rejectMessageDraft({ id: approved.id, expectedVersion: approved.version });
    const job = claimNextJob("test")!;
    const gateway = browser();
    await expect(handleJob(job, { conversationEngine: engine, browserGateway: gateway })).rejects.toThrow(/aprovação mudou/);
    expect(gateway.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("simulates an approved message once and requires a new human review for live sending", async () => {
    const recipient = lead();
    const approved = approvedFixture(recipient.id, "Texto", "browser");
    vi.spyOn(environment, "getEnv").mockReturnValue({ ...environment.getEnv(), DRY_RUN: true });
    const gateway = browser();
    await sendFirstContact(1, recipient.id, approved.body, gateway, false, approved.id);
    expect(gateway.sendFirstMessage.mock.calls[0][0].dryRun).toBe(true);
    expect(getMessageDraft(approved.id).status).toBe("simulated");
    vi.spyOn(environment, "getEnv").mockReturnValue({ ...environment.getEnv(), DRY_RUN: false });
    await expect(sendFirstContact(1, recipient.id, approved.body, gateway, false, approved.id)).rejects.toThrow(/já utilizada/);
    expect(gateway.sendFirstMessage).toHaveBeenCalledTimes(1);
  });

  it("blocks an API approval after opt-out and records uncertainty instead of retrying a network failure", async () => {
    const recipient = lead("api");
    const approved = approvedFixture(recipient.id, "Texto", "api");
    database.db.update(leads).set({ doNotContact: true }).where(eq(leads.id, recipient.id)).run();
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Lost connection"));
    await expect(sendInstagramApiMessage(recipient.id, approved.body, approved.id)).rejects.toThrow(/não contato/);
    expect(network).not.toHaveBeenCalled();
    database.db.update(leads).set({ doNotContact: false }).where(eq(leads.id, recipient.id)).run();
    await expect(sendInstagramApiMessage(recipient.id, approved.body, approved.id)).rejects.toThrow(/Lost connection/);
    expect(getMessageDraft(approved.id).status).toBe("uncertain");
    await expect(sendInstagramApiMessage(recipient.id, approved.body, approved.id)).rejects.toThrow(/já utilizada/);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("reserves API approval before the network and permits at most one concurrent send of the exact text", async () => {
    const recipient = lead("api");
    const approved = approvedFixture(recipient.id, "Texto exato aprovado", "api");
    let finish!: (response: Response) => void;
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = sendInstagramApiMessage(recipient.id, approved.body, approved.id);
    expect(getMessageDraft(approved.id).status).toBe("sending");
    await expect(sendInstagramApiMessage(recipient.id, approved.body, approved.id)).rejects.toThrow(/já utilizada/);
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).message.text).toBe(approved.body);
    finish(new Response(JSON.stringify({ message_id: "approved-api-1" }), { status: 200 }));
    await first;
    expect(network).toHaveBeenCalledTimes(1);
    expect(getMessageDraft(approved.id).status).toBe("sent");
  });

  it("spaces an approved batch and defers a late rate limit without using its approval", async () => {
    const first = lead();
    const second = lead("browser", "@segundo");
    const a = approvedFixture(first.id, "Primeiro", "browser");
    approvedFixture(second.id, "Segundo", "browser");
    const queued = database.sqlite.prepare("SELECT run_at FROM jobs ORDER BY run_at").all() as Array<{ run_at: number }>;
    expect(queued[1].run_at - queued[0].run_at).toBeGreaterThanOrEqual(30_000);
    const job = claimNextJob("test")!;
    const recent = lead("browser", "@terceiro");
    database.db.insert(messages).values({ leadId: recent.id, direction: "outbound", channel: "browser", deliveryState: "sent", body: "Anterior", dedupeKey: "recent", sentAt: new Date() }).run();
    const gateway = browser();
    await handleJob(job, { conversationEngine: engine, browserGateway: gateway });
    completeJob(job.id);
    expect(database.sqlite.prepare("SELECT status, attempts FROM jobs WHERE id = ?").get(job.id)).toEqual({ status: "pending", attempts: 0 });
    expect(getMessageDraft(a.id).status).toBe("approved");
    expect(gateway.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("marks an interrupted claimed approval uncertain without reauthorizing it", () => {
    const recipient = lead("api");
    const approved = approvedFixture(recipient.id, "Texto", "api");
    const job = claimNextJob("test")!;
    database.sqlite.transaction(() => claimMessageApproval({ id: approved.id, leadId: recipient.id, channel: "api", body: approved.body })).immediate();
    database.sqlite.prepare("UPDATE jobs SET locked_at = ? WHERE id = ?").run(Date.now() - 600_000, job.id);
    expect(recoverStaleJobs()).toBe(1);
    expect(getMessageDraft(approved.id).status).toBe("uncertain");
    expect(() => approveMessageDraft({ id: approved.id, expectedVersion: getMessageDraft(approved.id).version })).toThrow(/processada/);
  });
});
