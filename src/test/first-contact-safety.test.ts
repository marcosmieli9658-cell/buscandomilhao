import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { database } from "@/db/client";
import { leads, messages, systemSettings } from "@/db/schema";
import { sendReviewedFirstContact as sendFirstContact } from "./approval-fixtures";
import type { BrowserGateway, BrowserSendResult } from "@/integrations/browser/gateway";

beforeEach(() => {
  database.sqlite.exec(`
    DELETE FROM browser_artifacts; DELETE FROM exceptions; DELETE FROM webhook_events;
    DELETE FROM experiment_assignments; DELETE FROM experiment_variants; DELETE FROM experiments;
    DELETE FROM message_approvals; DELETE FROM ai_calls; DELETE FROM audit_logs; DELETE FROM events; DELETE FROM jobs;
    DELETE FROM messages; DELETE FROM leads; DELETE FROM system_settings;
  `);
  database.db.insert(systemSettings).values({ id: 1 }).run();
});

function createLead(overrides: Partial<typeof leads.$inferInsert> = {}) {
  return database.db.insert(leads).values({
    funnel: "client", instagramHandle: "@empresa_teste", source: "test",
    pipelineState: "qualified", ...overrides,
  }).returning().get();
}

function gateway(): BrowserGateway & { sendFirstMessage: ReturnType<typeof vi.fn> } {
  return { sendFirstMessage: vi.fn(async (request) => ({ sent: !request.dryRun, dryRun: request.dryRun, url: "https://www.instagram.com/direct/t/test/" })) };
}

function previousMessage(leadId: number, overrides: Partial<typeof messages.$inferInsert> = {}) {
  return database.db.insert(messages).values({
    leadId, direction: "outbound", channel: "human", body: "Contato anterior",
    deliveryState: "sent", dedupeKey: crypto.randomUUID(), ...overrides,
  }).returning().get();
}

describe("first-contact duplicate and uncertain-send protection", () => {
  it.each(["sent", "delivered"] as const)("blocks arbitrary %s outbound history before calling the browser", async (deliveryState) => {
    const lead = createLead();
    previousMessage(lead.id, { deliveryState });
    const browser = gateway();
    await expect(sendFirstContact(1, lead.id, "Nova mensagem", browser, false)).rejects.toThrow(/Previous contact/);
    expect(browser.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("blocks a previously contacted normalized handle in another funnel", async () => {
    const oldLead = createLead({ funnel: "affiliate", instagramHandle: "https://www.instagram.com/EMPRESA_TESTE/" });
    previousMessage(oldLead.id);
    const lead = createLead();
    const browser = gateway();
    await expect(sendFirstContact(1, lead.id, "Nova mensagem", browser, false)).rejects.toThrow(/Previous contact/);
    expect(browser.sendFirstMessage).not.toHaveBeenCalled();
  });

  it.each(["null", "[]", "true", "42", "invalid-json"])("preserves prior-contact blocking with legacy metadata %s", async (metadataJson) => {
    const lead = createLead();
    previousMessage(lead.id, { metadataJson });
    const browser = gateway();
    await expect(sendFirstContact(1, lead.id, "Nova mensagem", browser, false)).rejects.toThrow(/Previous contact/);
    expect(browser.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("uses the saved stable ID when a known account is represented by a new handle and lead", async () => {
    const oldLead = createLead({ funnel: "affiliate", instagramHandle: "@nome_antigo" });
    previousMessage(oldLead.id, { metadataJson: JSON.stringify({ instagramScopedId: "known-account" }) });
    const lead = createLead({ instagramScopedId: "known-account" });
    const browser = gateway();
    await expect(sendFirstContact(1, lead.id, "Nova mensagem", browser, false)).rejects.toThrow(/Previous contact/);
    expect(browser.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("preserves opt-out across equivalent handles in different funnels", async () => {
    createLead({ funnel: "affiliate", instagramHandle: "EMPRESA_TESTE", doNotContact: true });
    const lead = createLead();
    const browser = gateway();
    await expect(sendFirstContact(1, lead.id, "Nova mensagem", browser, false)).rejects.toThrow(/do-not-contact/);
    expect(browser.sendFirstMessage).not.toHaveBeenCalled();
  });

  it("reserves before the browser and blocks another attempt while the first is in flight", async () => {
    const lead = createLead();
    let finish!: (result: BrowserSendResult) => void;
    const browser = gateway();
    browser.sendFirstMessage.mockImplementation(() => new Promise<BrowserSendResult>((resolve) => { finish = resolve; }));
    const first = sendFirstContact(1, lead.id, "Primeira mensagem", browser, false);
    const reservation = database.db.select().from(messages).get();
    expect(reservation?.deliveryState).toBe("planned");
    expect(reservation?.sentAt).toBeNull();
    await expect(sendFirstContact(2, lead.id, "Concorrente", browser, false)).rejects.toThrow(/uncertain/);
    expect(browser.sendFirstMessage).toHaveBeenCalledTimes(1);
    finish({ sent: true, dryRun: false, url: "https://www.instagram.com/direct/t/test/" });
    await first;
    expect(database.db.select().from(messages).all()).toHaveLength(1);
    expect(database.db.select().from(messages).get()?.deliveryState).toBe("sent");
  });

  it("retains an uncertain reservation after a browser error and blocks a retry", async () => {
    const lead = createLead();
    const browser = gateway();
    browser.sendFirstMessage.mockRejectedValue(new Error("Connection lost after sending"));
    await expect(sendFirstContact(1, lead.id, "Mensagem", browser, false)).rejects.toThrow(/Connection lost/);
    await expect(sendFirstContact(1, lead.id, "Mensagem", browser, false)).rejects.toThrow(/uncertain/);
    expect(browser.sendFirstMessage).toHaveBeenCalledTimes(1);
    expect(database.db.select().from(messages).get()?.deliveryState).toBe("planned");
  });

  it("retains the reservation when the gateway does not confirm a real send", async () => {
    const lead = createLead();
    const browser = gateway();
    browser.sendFirstMessage.mockResolvedValue({ sent: false, dryRun: false, url: "https://www.instagram.com/" });
    await expect(sendFirstContact(1, lead.id, "Mensagem", browser, false)).rejects.toThrow(/not confirmed/);
    await expect(sendFirstContact(2, lead.id, "Mensagem", browser, false)).rejects.toThrow(/uncertain/);
    expect(browser.sendFirstMessage).toHaveBeenCalledTimes(1);
  });

  it.each(["retry", "dead_letter", "pending", "cancelled", "running"])("blocks an old %s job with an uncertain attempt without reopening it", async (status) => {
    const lead = createLead();
    const job = database.sqlite.prepare(`
      INSERT INTO jobs (type, status, payload_json, dedupe_key, attempts, run_at, created_at, updated_at)
      VALUES ('send_browser_dm', ?, ?, 'old-attempt', 2, 0, 0, 0)
    `).run(status, JSON.stringify({ leadId: lead.id, body: "Antiga" }));
    const browser = gateway();
    await expect(sendFirstContact(Number(job.lastInsertRowid), lead.id, "Nova", browser, false)).rejects.toThrow(/uncertain outcome/);
    expect(browser.sendFirstMessage).not.toHaveBeenCalled();
    expect(database.sqlite.prepare("SELECT status FROM jobs WHERE id = ?").get(job.lastInsertRowid)).toEqual({ status });
  });

  it("allows the first claimed job while keeping its new reservation separate from a simulation", async () => {
    const lead = createLead();
    const browser = gateway();
    await sendFirstContact(1, lead.id, "Prévia", browser, true);
    await sendFirstContact(1, lead.id, "Prévia", browser, true);
    expect(database.db.select().from(messages).all()).toHaveLength(1);
    const job = database.sqlite.prepare(`
      INSERT INTO jobs (type, status, payload_json, dedupe_key, attempts, run_at, created_at, updated_at)
      VALUES ('send_approved_browser', 'running', ?, 'first-attempt', 1, 0, 0, 0)
    `).run(JSON.stringify({ leadId: lead.id, body: "Aprovada" }));
    await sendFirstContact(Number(job.lastInsertRowid), lead.id, "Aprovada", browser, false);
    expect(database.db.select().from(messages).all().map((message) => message.deliveryState)).toEqual(["dry_run", "sent"]);
  });

  it("does not treat a legacy dry-run key as proof of a previous real send", async () => {
    const lead = createLead();
    previousMessage(lead.id, { channel: "browser", deliveryState: "dry_run", dedupeKey: crypto.createHash("sha256").update(`first_dm:${lead.id}`).digest("hex") });
    const browser = gateway();
    await sendFirstContact(1, lead.id, "Aprovada", browser, false);
    expect(browser.sendFirstMessage).toHaveBeenCalledTimes(1);
    expect(database.db.select().from(messages).all().map((message) => message.deliveryState)).toEqual(["dry_run", "sent"]);
  });
});
