import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { aiCalls, experimentAssignments, experiments, experimentVariants, leads, messages, systemSettings } from "@/db/schema";
import { assignActiveVariant } from "@/features/experiments/service";
import { discoverLead, markDoNotContact, transitionChannel, transitionPipeline } from "@/features/leads/service";
import { extractVisibleExternalUrl, inferSuggestedService, instagramSearchKeyword, profileMatchesQuery, type BrowserGateway } from "@/integrations/browser/gateway";
import { sendFirstContact, assertOperatingLimits, nextBrowserSendAt } from "@/integrations/browser/service";
import { sendInstagramApiMessage } from "@/integrations/instagram/api";
import { verifyMetaSignature } from "@/integrations/instagram/signature";
import { processInstagramWebhook } from "@/integrations/instagram/webhook";
import { OpenAiConversationEngine } from "@/integrations/openai/engine";
import { claimNextJob, enqueueJob, pauseBrowserQueue, recoverStaleJobs } from "@/worker/queue";
import { isAutonomousDiscoveryWindow } from "@/worker/scheduler";
import crypto from "node:crypto";
import * as environment from "@/lib/env";

const baseEnvironment = environment.getEnv();
function configureApi(dryRun = false) {
  vi.spyOn(environment, "getEnv").mockReturnValue({ ...baseEnvironment, DRY_RUN: dryRun, INSTAGRAM_PAGE_ACCESS_TOKEN: "test-token", INSTAGRAM_BUSINESS_ACCOUNT_ID: "test-account" });
}

const fakeBrowser: BrowserGateway = {
  async sendFirstMessage(request) { return { sent: !request.dryRun, dryRun: request.dryRun, url: `https://www.instagram.com/${request.handle.replace("@", "")}/` }; },
};

function resetDatabase() {
  database.sqlite.exec(`
    DELETE FROM browser_artifacts; DELETE FROM exceptions; DELETE FROM webhook_events;
    DELETE FROM experiment_assignments; DELETE FROM experiment_variants; DELETE FROM experiments;
    DELETE FROM ai_calls; DELETE FROM audit_logs; DELETE FROM events; DELETE FROM jobs; DELETE FROM messages; DELETE FROM leads; DELETE FROM system_settings;
  `);
  const now = new Date();
  database.db.insert(systemSettings).values({ id: 1, createdAt: now, updatedAt: now }).run();
}

function createQualifiedLead(handle = "@empresa_teste") {
  const result = discoverLead({ funnel: "client", instagramHandle: handle, displayName: "Empresa Teste", bio: "Clínica em São José dos Campos", segment: "clínicas e consultórios", source: "test", score: 80 });
  transitionPipeline(result.lead.id, "qualified", "test");
  return result.lead.id;
}

beforeEach(() => {
  resetDatabase();
  vi.restoreAllMocks();
  delete process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
  delete process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
});

describe("critical autonomous sales flows", () => {
  it("filters Instagram discovery by segment and requested city", () => {
    expect(instagramSearchKeyword("clínica estética São José dos Campos")).toBe("clinica estetica sjc");
    expect(profileMatchesQuery("clínica estética são josé dos campos", "Clínica de estética em São José dos Campos", true)).toBe(true);
    expect(profileMatchesQuery("clínica estética são josé dos campos", "Portal de notícias de São José dos Campos", true)).toBe(false);
    expect(profileMatchesQuery("clínica estética são josé dos campos", "Clínica de estética em Taubaté", true)).toBe(false);
    expect(profileMatchesQuery("clínica estética são josé dos campos", "Churrascaria e bar em SJC", true)).toBe(false);
    expect(profileMatchesQuery("fisioterapia são josé dos campos", "Fisioterapeuta esportiva em SJC", true)).toBe(true);
    expect(profileMatchesQuery("arquiteto são josé dos campos", "Escritório de arquitetura em SJC", true)).toBe(true);
  });

  it("suggests an offer only from public website evidence", () => {
    expect(inferSuggestedService("Clínica de estética em SJC")).toBe("site_creation");
    expect(inferSuggestedService("Loja de roupas femininas", "https://linktr.ee/lojateste")).toBe("ecommerce");
    expect(inferSuggestedService("Escritório de arquitetura", "https://arquiteturateste.com.br/")).toBe("site_diagnostic");
    expect(extractVisibleExternalUrl("Veja nossos links em linktr.ee/clinicadravanessa")).toBe("https://linktr.ee/clinicadravanessa");
  });

  it("deduplicates discovered leads", () => {
    const first = discoverLead({ funnel: "client", instagramHandle: "Empresa.Teste", source: "search", score: 70 });
    const second = discoverLead({ funnel: "client", instagramHandle: "@empresa.teste", source: "search", score: 70 });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(database.db.select().from(leads).all()).toHaveLength(1);
  });

  it("enforces valid pipeline and channel transitions", () => {
    const leadId = createQualifiedLead();
    transitionPipeline(leadId, "contacted", "test");
    expect(() => transitionPipeline(leadId, "active_customer", "test")).toThrow(/Invalid/);
    transitionChannel(leadId, "browser_contact_sent", "browser", "test");
    transitionChannel(leadId, "waiting_inbound_reply", "browser", "test");
    expect(() => transitionChannel(leadId, "api_active", "api", "test")).toThrow(/Invalid/);
  });

  it("sends first contact once through the isolated browser gateway", async () => {
    const leadId = createQualifiedLead();
    const result = await sendFirstContact(10, leadId, "Olá, mensagem real baseada no perfil.", fakeBrowser, false);
    expect(result.sent).toBe(true);
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    expect(lead?.channelState).toBe("waiting_inbound_reply");
    expect(lead?.pipelineState).toBe("contacted");
    await expect(sendFirstContact(11, leadId, "Duplicada", fakeBrowser, false)).rejects.toThrow();
    expect(database.db.select().from(messages).all()).toHaveLength(1);
  });

  it("spaces queued browser contacts inside the configured random interval", () => {
    const now = new Date("2026-09-05T15:00:00.000Z");
    expect(nextBrowserSendAt(now, () => 0)).toEqual(now);
    enqueueJob("send_browser_dm", { leadId: 10 }, { dedupeKey: "scheduled-browser-1", runAt: now });
    expect(nextBrowserSendAt(now, () => 0).getTime()).toBe(now.getTime() + 30_000);
    expect(nextBrowserSendAt(now, () => 1).getTime()).toBe(now.getTime() + 60_000);
  });

  it("starts autonomous discovery on weekdays only and not before the approved date", () => {
    const input = { timezone: "America/Sao_Paulo", operatingHours: "09:00-20:00", startDate: "2026-09-07", weekdays: [1, 2, 3, 4, 5] };
    expect(isAutonomousDiscoveryWindow({ ...input, now: new Date("2026-09-05T15:00:00Z") })).toBe(false);
    expect(isAutonomousDiscoveryWindow({ ...input, now: new Date("2026-09-07T11:59:00Z") })).toBe(false);
    expect(isAutonomousDiscoveryWindow({ ...input, now: new Date("2026-09-07T12:00:00Z") })).toBe(true);
    expect(isAutonomousDiscoveryWindow({ ...input, now: new Date("2026-09-12T15:00:00Z") })).toBe(false);
  });

  it("hands an inbound reply from browser ownership to the official API idempotently", async () => {
    const leadId = createQualifiedLead("@responde_teste");
    await sendFirstContact(20, leadId, "Olá!", fakeBrowser, false);
    const payload = JSON.stringify({ object: "instagram", entry: [{ messaging: [{ sender: { id: "igsid-123", username: "responde_teste" }, timestamp: Date.now(), message: { mid: "mid-123", text: "Tenho interesse, pode explicar?" } }] }] });
    const first = await processInstagramWebhook(payload);
    const second = await processInstagramWebhook(payload);
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    expect(first.received).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(lead?.channelOwner).toBe("api");
    expect(lead?.channelState).toBe("api_active");
    expect(lead?.pipelineState).toBe("replied");
    expect(database.db.select().from(messages).all()).toHaveLength(2);
  });

  it("blocks API sends outside the 24-hour eligibility window", async () => {
    configureApi();
    const leadId = createQualifiedLead();
    database.db.update(leads).set({ instagramScopedId: "igsid-expired", channelState: "api_active", channelOwner: "api", lastInboundAt: new Date(Date.now() - 25 * 60 * 60_000) }).where(eq(leads.id, leadId)).run();
    await expect(sendInstagramApiMessage(leadId, "Mensagem tardia")).rejects.toThrow(/expired/);
  });

  it("simulates API responses without network calls or delivery state changes", async () => {
    configureApi(true);
    const leadId = createQualifiedLead();
    database.db.update(leads).set({ instagramScopedId: "igsid-test", channelState: "api_active", channelOwner: "api", lastInboundAt: new Date() }).where(eq(leads.id, leadId)).run();
    const network = vi.spyOn(globalThis, "fetch");
    expect((await sendInstagramApiMessage(leadId, "Simulação")).dry_run).toBe(true);
    await sendInstagramApiMessage(leadId, "Simulação");
    expect(network).not.toHaveBeenCalled();
    expect(database.db.select().from(messages).all()).toHaveLength(1);
    expect(database.db.select().from(messages).get()?.deliveryState).toBe("dry_run");
    expect(database.db.select().from(leads).where(eq(leads.id, leadId)).get()?.lastOutboundAt).toBeNull();
  });

  it("does not let simulation records block an approved live API send", async () => {
    configureApi(true);
    const leadId = createQualifiedLead();
    database.db.update(leads).set({ instagramScopedId: "igsid-test", channelState: "api_active", channelOwner: "api", lastInboundAt: new Date() }).where(eq(leads.id, leadId)).run();
    await sendInstagramApiMessage(leadId, "Mensagem");
    configureApi(false);
    const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message_id: "mid-test" }), { status: 200 }));
    expect((await sendInstagramApiMessage(leadId, "Mensagem")).dry_run).toBe(false);
    expect(network).toHaveBeenCalledOnce();
    expect(database.db.select().from(messages).all()).toHaveLength(2);
  });

  it("blocks direct API sends while the operation is paused", async () => {
    configureApi();
    const leadId = createQualifiedLead();
    database.db.update(systemSettings).set({ globallyPaused: true }).where(eq(systemSettings.id, 1)).run();
    const network = vi.spyOn(globalThis, "fetch");
    await expect(sendInstagramApiMessage(leadId, "Bloqueada")).rejects.toThrow(/paused/);
    expect(network).not.toHaveBeenCalled();
  });

  it("makes do-not-contact permanent and clears future action", () => {
    const leadId = createQualifiedLead();
    database.db.update(leads).set({ nextActionAt: new Date(Date.now() + 86_400_000) }).where(eq(leads.id, leadId)).run();
    markDoNotContact(leadId, "Pedido explícito", "test");
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    expect(lead?.doNotContact).toBe(true);
    expect(lead?.channelState).toBe("do_not_contact");
    expect(lead?.nextActionAt).toBeNull();
  });

  it("assigns one deterministic experiment variant per lead", () => {
    const leadId = createQualifiedLead();
    const experiment = database.db.insert(experiments).values({ name: "Abertura", funnel: "client", variable: "opening", status: "running", hypothesis: "Contexto público aumenta resposta", createdAt: new Date(), updatedAt: new Date() }).returning().get();
    database.db.insert(experimentVariants).values([
      { experimentId: experiment.id, name: "Controle", content: "Mensagem A", weight: 0.5, isControl: true, createdAt: new Date(), updatedAt: new Date() },
      { experimentId: experiment.id, name: "Contexto", content: "Mensagem B", weight: 0.5, createdAt: new Date(), updatedAt: new Date() },
    ]).run();
    const first = assignActiveVariant(leadId, "client");
    const second = assignActiveVariant(leadId, "client");
    expect(first?.id).toBe(second?.id);
    expect(database.db.select().from(experimentAssignments).all()).toHaveLength(1);
  });

  it("recovers stale jobs and preserves scheduled follow-ups", () => {
    enqueueJob("follow_up", { leadId: 99 }, { dedupeKey: "follow-up-test", runAt: new Date(Date.now() + 60_000) });
    expect(claimNextJob("worker-test")).toBeNull();
    database.sqlite.prepare("UPDATE jobs SET status = 'running', locked_at = ?, run_at = ? WHERE dedupe_key = ?").run(Date.now() - 600_000, Date.now() - 1, "follow-up-test");
    expect(recoverStaleJobs()).toBe(1);
    expect(claimNextJob("worker-after-restart")?.type).toBe("follow_up");
  });

  it("opens the circuit breaker when the browser becomes unavailable", () => {
    pauseBrowserQueue("browser_unavailable");
    expect(() => assertOperatingLimits()).toThrow(/Browser queue is paused/);
  });

  it("keeps browser jobs queued while API jobs continue in operator-assisted mode", () => {
    enqueueJob("send_browser_dm", { leadId: 1 }, { dedupeKey: "browser-assisted" });
    enqueueJob("process_inbound", { leadId: 1 }, { dedupeKey: "api-continues" });
    pauseBrowserQueue("operator_assisted_browser");
    expect(claimNextJob("worker-test")?.type).toBe("process_inbound");
    expect(database.sqlite.prepare("SELECT status FROM jobs WHERE dedupe_key = 'browser-assisted'").get()).toEqual({ status: "pending" });
  });

  it("pauses before an OpenAI call after the monthly budget is reached", async () => {
    const leadId = createQualifiedLead();
    database.db.insert(aiCalls).values({ leadId, model: "gpt-5.4-2026-03-05", purpose: "test", inputTokens: 1, outputTokens: 1, estimatedCostUsd: 50, createdAt: new Date(), updatedAt: new Date() }).run();
    const engine = new OpenAiConversationEngine("sk-test");
    await expect(engine.generateFirstContact(leadId)).rejects.toThrow(/budget reached/);
    expect(database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get()?.globallyPaused).toBe(true);
  });

  it("verifies Meta webhook HMAC signatures", () => {
    const raw = JSON.stringify({ object: "instagram" });
    const secret = "secret";
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, secret)).toBe(true);
    expect(verifyMetaSignature(raw, "sha256=00", secret)).toBe(false);
  });
});
