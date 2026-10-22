import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "@/db/client";
import { leads, messageApprovals, systemSettings } from "@/db/schema";
import { assertFirstContactEligible, createMessageDraft, getMessageDraft } from "@/features/approvals/service";
import { instagramRequestsDisabledError, instagramRequestsDisabledErrors } from "@/integrations/browser/gateway";
import { processInstagramWebhook } from "@/integrations/instagram/webhook";
import { claimExactAssistedJob, runAssistedSend, validateAssistedAcknowledgement, waitForAssistedAcknowledgement, type AssistedRequest, type AssistedSelection } from "@/integrations/browser/operator-assisted";
import * as business from "@/lib/business";
import * as environment from "@/lib/env";
import * as scheduling from "@/integrations/browser/scheduling";
import { approvedFixture } from "./approval-fixtures";

const baseEnvironment = environment.getEnv();
let artifactRoot: string;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(environment, "getEnv").mockReturnValue({ ...baseEnvironment, DRY_RUN: false, OPERATING_HOURS: "00:00-23:59", OPERATING_DAYS: "0,1,2,3,4,5,6" });
  vi.spyOn(business, "getBusinessConfig").mockReturnValue({ instagramHandle: "@agenciablessialabs" } as business.BusinessConfig);
  database.sqlite.exec(`DELETE FROM browser_artifacts; DELETE FROM exceptions; DELETE FROM webhook_events;
    DELETE FROM experiment_assignments; DELETE FROM experiment_variants; DELETE FROM experiments;
    DELETE FROM message_approvals; DELETE FROM ai_calls; DELETE FROM audit_logs; DELETE FROM events;
    DELETE FROM jobs; DELETE FROM messages; DELETE FROM leads; DELETE FROM system_settings;`);
  database.db.insert(systemSettings).values({ id: 1, globallyPaused: true, browserQueuePaused: true, pauseReason: "Pausa do operador", browserPauseReason: "Pausa do browser" }).run();
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blessia-assisted-test-"));
});

afterEach(() => {
  if (path.dirname(artifactRoot) !== path.resolve(os.tmpdir()) || !path.basename(artifactRoot).startsWith("blessia-assisted-test-")) throw new Error("Unexpected test directory");
  fs.rmSync(artifactRoot, { recursive: true });
});

function selection(handle = "@cliente_teste"): AssistedSelection {
  const lead = database.db.insert(leads).values({ funnel: "client", instagramHandle: handle, source: "test", pipelineState: "discovered", channelOwner: "browser", channelState: "browser_contact_pending" }).returning().get();
  const approved = approvedFixture(lead.id, "Oi! Sou o Marcos, da Blessia Labs. Vocês já têm site?", "browser");
  const job = database.sqlite.prepare("SELECT id FROM jobs WHERE json_extract(payload_json, '$.approvalId') = ?").get(approved.id) as { id: number };
  // Fixture is intentionally due, independent of batch scheduling; the transport still enforces rate limits.
  database.sqlite.prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(Date.now() - 1_000, job.id);
  return { approvalId: approved.id, approvalVersion: approved.version, jobId: job.id };
}

function acknowledgement(request: AssistedRequest) {
  const proofPath = path.join(artifactRoot, "visible-message.png");
  fs.writeFileSync(proofPath, "synthetic screenshot bytes for an isolated test");
  const matching = { approvalId: request.approvalId, approvalVersion: request.approvalVersion, jobId: request.jobId,
    nonce: request.nonce, sender: request.sender, recipientHandle: request.recipientHandle, bodySha256: request.bodySha256 };
  return { ...matching, threadUrl: "https://www.instagram.com/direct/t/123456/", proofPath, confirmedVisible: true as const, confirmedAt: new Date().toISOString() };
}

function pauses() {
  return database.sqlite.prepare("SELECT globally_paused, browser_queue_paused, pause_reason, browser_pause_reason FROM system_settings WHERE id = 1").get();
}

const expectedPauses = { globally_paused: 1, browser_queue_paused: 1, pause_reason: "Pausa do operador", browser_pause_reason: "Pausa do browser" };

function negativeAcknowledgement(request: AssistedRequest) {
  const positive = acknowledgement(request);
  return { approvalId: positive.approvalId, approvalVersion: positive.approvalVersion, jobId: positive.jobId,
    nonce: positive.nonce, sender: positive.sender, recipientHandle: positive.recipientHandle, bodySha256: positive.bodySha256,
    threadUrl: positive.threadUrl, proofPath: positive.proofPath, confirmedAt: positive.confirmedAt,
    outcome: "blocked" as const, reasonCode: "instagram_new_message_requests_disabled" as const, observedError: instagramRequestsDisabledError };
}

describe("operator-assisted exact approved dispatch", () => {
  it("claims only the specified matching job and never takes earlier inbound or another approved job", () => {
    const first = selection();
    const second = selection("@outro");
    database.sqlite.prepare("INSERT INTO jobs(type,status,payload_json,dedupe_key,run_at,created_at,updated_at) VALUES('process_inbound','pending','{}','inbound',0,0,0)").run();
    expect(() => claimExactAssistedJob({ ...first, jobId: second.jobId }, "test")).toThrow(/não corresponde/);
    expect(() => claimExactAssistedJob({ ...second, approvalVersion: second.approvalVersion + 1 }, "test")).toThrow(/alterada/);
    const claimed = claimExactAssistedJob(second, "test");
    expect(claimed).toMatchObject({ id: second.jobId, attempts: 1 });
    expect(database.sqlite.prepare("SELECT status,attempts FROM jobs WHERE id = ?").get(first.jobId)).toEqual({ status: "pending", attempts: 0 });
    expect(database.sqlite.prepare("SELECT status FROM jobs WHERE type = 'process_inbound'").get()).toEqual({ status: "pending" });
    expect(() => claimExactAssistedJob(second, "test")).toThrow(/primeira execução/);
    expect(pauses()).toEqual(expectedPauses);
  });

  it.each(["future", "retried", "changed_recipient", "missing_direct_check"])("rejects %s before claim", (kind) => {
    const target = selection();
    if (kind === "future") database.sqlite.prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(Date.now() + 60_000, target.jobId);
    if (kind === "retried") database.sqlite.prepare("UPDATE jobs SET attempts = 1 WHERE id = ?").run(target.jobId);
    if (kind === "changed_recipient") database.sqlite.prepare("UPDATE leads SET instagram_handle = '@changed'").run();
    if (kind === "missing_direct_check") database.sqlite.prepare("UPDATE message_approvals SET direct_history_checked = 0").run();
    expect(() => claimExactAssistedJob(target, "test")).toThrow();
    expect(database.sqlite.prepare("SELECT status FROM jobs WHERE id = ?").get(target.jobId)).toEqual({ status: "pending" });
  });

  it("reserves before exchange, keeps both queues paused while the operator works and records one confirmed send", async () => {
    vi.spyOn(scheduling, "getZonedTimeParts").mockReturnValue({ ...scheduling.getZonedTimeParts(new Date(), baseEnvironment.OPERATING_TIMEZONE), hour: "10", minute: "00" });
    const target = selection();
    const assertNoWorker = vi.fn(async () => {});
    const network = vi.spyOn(globalThis, "fetch");
    const result = await runAssistedSend(target, { artifactRoot, assertNoWorker, exchange: async (request) => {
      expect(Date.parse(request.expiresAt) - Date.parse(request.createdAt)).toBe(240_000);
      expect(pauses()).toEqual(expectedPauses);
      expect(getMessageDraft(target.approvalId).status).toBe("sending");
      expect(database.sqlite.prepare("SELECT delivery_state FROM messages").get()).toEqual({ delivery_state: "planned" });
      return acknowledgement(request);
    } });
    expect(result).toBe("sent");
    expect(getMessageDraft(target.approvalId).status).toBe("sent");
    expect(database.sqlite.prepare("SELECT status, attempts FROM jobs WHERE id = ?").get(target.jobId)).toEqual({ status: "completed", attempts: 1 });
    expect(pauses()).toEqual(expectedPauses);
    expect(assertNoWorker).toHaveBeenCalledTimes(2);
    expect(network).not.toHaveBeenCalled();
    expect(fs.readdirSync(artifactRoot).some((file) => file.endsWith(".accepted.json"))).toBe(true);
    await expect(runAssistedSend(target, { artifactRoot, assertNoWorker, exchange: async () => null })).rejects.toThrow(/alterada/);
  });

  it.each(["nonce", "recipientHandle", "bodySha256", "sender", "approvalVersion", "threadUrl", "confirmedVisible", "expired"])("rejects mismatched or invalid ACK %s and retains uncertainty without retry", async (field) => {
    const target = selection();
    await expect(runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange: async (request) => {
      const ack = acknowledgement(request);
      if (field === "expired") return validateAssistedAcknowledgement(ack, request, [artifactRoot], Date.parse(request.expiresAt) + 1);
      return { ...ack, [field]: field === "approvalVersion" ? 999 : field === "confirmedVisible" ? false : "wrong" };
    } })).rejects.toThrow();
    expect(getMessageDraft(target.approvalId).status).toBe("uncertain");
    expect(database.sqlite.prepare("SELECT delivery_state FROM messages").get()).toEqual({ delivery_state: "planned" });
    expect(database.sqlite.prepare("SELECT status, attempts FROM jobs WHERE id = ?").get(target.jobId)).toEqual({ status: "dead_letter", attempts: 1 });
    expect(pauses()).toEqual(expectedPauses);
  });

  it("times out without an ACK and restores pauses; recovery journal is available", async () => {
    const target = selection();
    await expect(runAssistedSend(target, { artifactRoot, timeoutMs: 10, assertNoWorker: async () => {}, exchange: waitForAssistedAcknowledgement })).rejects.toThrow();
    expect(getMessageDraft(target.approvalId).status).toBe("uncertain");
    expect(pauses()).toEqual(expectedPauses);
    const journal = fs.readdirSync(artifactRoot).find((file) => file.endsWith(".recovery.json"))!;
    expect(JSON.parse(fs.readFileSync(path.join(artifactRoot, journal), "utf8"))).toMatchObject({ phase: "uncertain", pausesRestored: true, previousPause: expectedPauses });
  });

  it("records an evidenced platform rejection as blocked without sent, opt-out or automatic retry, including another funnel", async () => {
    const target = selection();
    const result = await runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange: async (request) => negativeAcknowledgement(request) });
    expect(result).toBe("blocked");
    const approved = getMessageDraft(target.approvalId);
    expect(approved.status).toBe("rejected");
    expect(approved.sentAt).toBeNull();
    expect(database.sqlite.prepare("SELECT delivery_state, sent_at FROM messages").get()).toEqual({ delivery_state: "blocked", sent_at: null });
    expect(database.sqlite.prepare("SELECT status,attempts,locked_at,locked_by FROM jobs WHERE id=?").get(target.jobId)).toEqual({ status: "dead_letter", attempts: 1, locked_at: null, locked_by: null });
    expect(database.sqlite.prepare("SELECT do_not_contact,channel_state,channel_owner,pipeline_state FROM leads WHERE id=?").get(approved.leadId)).toEqual({ do_not_contact: 0, channel_state: "blocked", channel_owner: "none", pipeline_state: "closed" });
    expect(database.sqlite.prepare("SELECT count(*) n FROM events WHERE type IN('opt_out','browser_dm_sent')").get()).toEqual({ n: 0 });
    expect(database.sqlite.prepare("SELECT count(*) n FROM jobs WHERE status IN('pending','retry','running')").get()).toEqual({ n: 0 });
    expect(pauses()).toEqual(expectedPauses);
    const alias = database.db.insert(leads).values({ funnel: "affiliate", instagramHandle: "@CLIENTE_TESTE", source: "test", channelOwner: "browser", channelState: "browser_contact_pending" }).returning().get();
    expect(() => assertFirstContactEligible(alias.id)).toThrow(/Instagram recusou/);
    await expect(runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange: async () => null })).rejects.toThrow(/alterada/);
  });

  it("records the exact Portuguese rejection without translating the observed evidence", async () => {
    const target = selection();
    expect(await runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange: async (request) => ({
      ...negativeAcknowledgement(request), observedError: instagramRequestsDisabledErrors[1],
    }) })).toBe("blocked");
    const message = database.sqlite.prepare("SELECT delivery_state,metadata_json,sent_at FROM messages").get() as { delivery_state: string; metadata_json: string; sent_at: number | null };
    expect(message.delivery_state).toBe("blocked");
    expect(message.sent_at).toBeNull();
    expect(JSON.parse(message.metadata_json).platformBlock.observedError).toBe(instagramRequestsDisabledErrors[1]);
    expect(getMessageDraft(target.approvalId).status).toBe("rejected");
    expect(database.sqlite.prepare("SELECT status,attempts FROM jobs WHERE id=?").get(target.jobId)).toEqual({ status: "dead_letter", attempts: 1 });
    expect(pauses()).toEqual(expectedPauses);
  });

  it("completes the send when an inbound reply takes API ownership before its acknowledgement", async () => {
    const target = selection("@quick_reply");
    const result = await runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange: async (request) => {
      expect(await processInstagramWebhook(JSON.stringify({ object: "instagram", entry: [{ messaging: [{
        sender: { id: "incoming-scoped-id", username: "quick_reply" }, timestamp: Date.now(),
        message: { mid: "reply-before-ack", text: "Olá, recebemos seu contato." },
      }] }] }))).toEqual({ received: 1, duplicates: 0 });
      expect(database.sqlite.prepare("SELECT channel_owner,channel_state,pipeline_state FROM leads").get()).toEqual({ channel_owner: "api", channel_state: "api_active", pipeline_state: "replied" });
      return acknowledgement(request);
    } });
    expect(result).toBe("sent");
    expect(getMessageDraft(target.approvalId).status).toBe("sent");
    expect(database.sqlite.prepare("SELECT status,attempts FROM jobs WHERE id=?").get(target.jobId)).toEqual({ status: "completed", attempts: 1 });
    expect(database.sqlite.prepare("SELECT channel_owner,channel_state,pipeline_state,instagram_scoped_id FROM leads").get()).toEqual({ channel_owner: "api", channel_state: "api_active", pipeline_state: "replied", instagram_scoped_id: "incoming-scoped-id" });
    expect(database.sqlite.prepare("SELECT status,attempts FROM jobs WHERE type='process_inbound'").get()).toEqual({ status: "pending", attempts: 0 });
    expect(database.sqlite.prepare("SELECT direction,delivery_state FROM messages ORDER BY id").all()).toEqual([{ direction: "outbound", delivery_state: "sent" }, { direction: "inbound", delivery_state: "delivered" }]);
    expect(database.sqlite.prepare("SELECT count(*) n FROM exceptions").get()).toEqual({ n: 0 });
    expect(pauses()).toEqual(expectedPauses);
  });

  it("keeps a newer inbound conversation available for review after a negative acknowledgement without reopening first contact", async () => {
    const target = selection("@inbound_during_rejection");
    let inboundLead: unknown;
    const result = await runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange: async (request) => {
      expect(await processInstagramWebhook(JSON.stringify({ object: "instagram", entry: [{ messaging: [{
        sender: { id: "rejection-inbound-id", username: "inbound_during_rejection" }, timestamp: Date.now(),
        message: { mid: "inbound-before-negative-ack", text: "Olá, gostaria de saber mais sobre os sites." },
      }] }] }))).toEqual({ received: 1, duplicates: 0 });
      inboundLead = database.sqlite.prepare("SELECT * FROM leads").get();
      return negativeAcknowledgement(request);
    } });
    expect(result).toBe("blocked");
    const rejected = getMessageDraft(target.approvalId);
    expect(rejected.status).toBe("rejected");
    expect(rejected.sentAt).toBeNull();
    expect(database.sqlite.prepare("SELECT * FROM leads").get()).toEqual(inboundLead);
    expect(database.sqlite.prepare("SELECT channel_owner,channel_state,pipeline_state,do_not_contact FROM leads").get()).toEqual({ channel_owner: "api", channel_state: "api_active", pipeline_state: "replied", do_not_contact: 0 });
    expect(database.sqlite.prepare("SELECT direction,delivery_state FROM messages ORDER BY id").all()).toEqual([{ direction: "outbound", delivery_state: "blocked" }, { direction: "inbound", delivery_state: "delivered" }]);
    expect(database.sqlite.prepare("SELECT status,attempts FROM jobs WHERE id=?").get(target.jobId)).toEqual({ status: "dead_letter", attempts: 1 });
    expect(database.sqlite.prepare("SELECT status,attempts FROM jobs WHERE type='process_inbound'").get()).toEqual({ status: "pending", attempts: 0 });
    expect(() => assertFirstContactEligible(rejected.leadId)).toThrow(/Instagram recusou/);
    const reply = createMessageDraft({ leadId: rejected.leadId, channel: "api", purpose: "reply", body: "Podemos explicar as opções de site por aqui." });
    expect(reply.status).toBe("pending");
    expect(database.sqlite.prepare("SELECT count(*) n FROM jobs WHERE type='send_approved_api'").get()).toEqual({ n: 0 });
    expect(pauses()).toEqual(expectedPauses);
  });

  it.each(["observedError", "nonce", "bodySha256", "proofPath"])("does not accept a negative ACK with invalid %s", async (field) => {
    const target = selection();
    await expect(runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange: async (request) => ({ ...negativeAcknowledgement(request), [field]: "unverified" }) })).rejects.toThrow();
    expect(getMessageDraft(target.approvalId).status).toBe("uncertain");
    expect(database.sqlite.prepare("SELECT delivery_state,sent_at FROM messages").get()).toEqual({ delivery_state: "planned", sent_at: null });
    expect(database.sqlite.prepare("SELECT do_not_contact,channel_state FROM leads").get()).toEqual({ do_not_contact: 0, channel_state: "browser_contact_pending" });
    expect(pauses()).toEqual(expectedPauses);
  });

  it("does not turn a separately verified known-not-sent record into a platform block", () => {
    const target = selection();
    const approved = getMessageDraft(target.approvalId);
    database.sqlite.prepare("INSERT INTO messages(lead_id,direction,channel,body,delivery_state,dedupe_key,metadata_json,created_at,updated_at) VALUES(?,'outbound','browser','No attempt','blocked','known-not-sent',?,0,0)")
      .run(approved.leadId, JSON.stringify({ firstContactAttempt: "known_not_sent", instagramHandle: approved.recipientHandle }));
    expect(() => assertFirstContactEligible(approved.leadId)).not.toThrow();
  });

  it("preserves an operator's newer pause reason and fails if a worker appears after claim", async () => {
    const target = selection();
    let calls = 0;
    const exchange = vi.fn(async () => null);
    await expect(runAssistedSend(target, { artifactRoot, exchange, assertNoWorker: async () => {
      if (++calls === 2) {
        database.sqlite.prepare("UPDATE system_settings SET pause_reason = 'Nova pausa'").run();
        throw new Error("worker appeared");
      }
    } })).rejects.toThrow(/worker appeared/);
    expect(exchange).not.toHaveBeenCalled();
    expect(pauses()).toEqual({ ...expectedPauses, pause_reason: "Nova pausa" });
    expect(getMessageDraft(target.approvalId).status).toBe("uncertain");
  });

  it("defers an operating limit before reservation without consuming approval or lifting pauses", async () => {
    const target = selection();
    vi.spyOn(environment, "getEnv").mockReturnValue({ ...baseEnvironment, DRY_RUN: false, OPERATING_DAYS: "" });
    const exchange = vi.fn(async () => null);
    expect(await runAssistedSend(target, { artifactRoot, assertNoWorker: async () => {}, exchange })).toBe("deferred");
    expect(getMessageDraft(target.approvalId).status).toBe("approved");
    expect(database.sqlite.prepare("SELECT status,attempts FROM jobs WHERE id = ?").get(target.jobId)).toEqual({ status: "pending", attempts: 0 });
    expect(database.db.select().from(messageApprovals).all()).toHaveLength(1);
    expect(database.sqlite.prepare("SELECT count(*) n FROM messages").get()).toEqual({ n: 0 });
    expect(exchange).not.toHaveBeenCalled();
    expect(pauses()).toEqual(expectedPauses);
  });
});
