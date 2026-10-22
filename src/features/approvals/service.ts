import { desc, eq } from "drizzle-orm";
import { database } from "@/db/client";
import { leads, messageApprovals } from "@/db/schema";
import { normalizeInstagramHandle } from "@/features/leads/service";
import { nextBrowserSendAt } from "@/integrations/browser/scheduling";
import { enqueueJob } from "@/worker/queue";

export type MessageDraft = typeof messageApprovals.$inferSelect;
type Channel = MessageDraft["channel"];
type Purpose = MessageDraft["purpose"];
type Revision = { id: number; expectedVersion: number };

function validId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Identificador inválido.");
}

function validateBody(body: string, required = false): void {
  if (typeof body !== "string" || body.length > 1000 || (required && !body.trim())) throw new Error("Escreva uma mensagem de até 1.000 caracteres antes de aprovar.");
}

function validateReason(reason: string): void {
  if (typeof reason !== "string" || reason.length > 1000) throw new Error("O motivo deve ter até 1.000 caracteres.");
}

function normalizedHandle(handle: string): string | null {
  try { return normalizeInstagramHandle(handle); } catch { return null; }
}

function identity(leadId: number) {
  validId(leadId);
  const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead) throw new Error("Contato não encontrado.");
  const handle = normalizeInstagramHandle(lead.instagramHandle);
  const related = database.db.select().from(leads).all().filter((item) => normalizedHandle(item.instagramHandle) === handle
    || Boolean(lead.instagramScopedId && item.instagramScopedId === lead.instagramScopedId));
  if (related.some((item) => item.doNotContact)) throw new Error("Contato bloqueado: existe pedido de não contato (do-not-contact).");
  return { lead, handle, ids: new Set(related.map((item) => item.id)) };
}

export function assertFirstContactEligible(leadId: number, currentJobId = -1): void {
  const { lead, handle, ids } = identity(leadId);
  const history = database.sqlite.prepare(`SELECT lead_id, delivery_state, metadata_json FROM messages
    WHERE direction = 'outbound' AND delivery_state IN ('sent', 'delivered', 'planned')`).all() as Array<{ lead_id: number; delivery_state: string; metadata_json: string }>;
  for (const previous of history) {
    let metadata: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(previous.metadata_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
    } catch { /* Legacy rows may not have valid metadata. */ }
    const same = ids.has(previous.lead_id) || metadata.instagramHandle === handle
      || Boolean(lead.instagramScopedId && metadata.instagramScopedId === lead.instagramScopedId);
    if (same && (previous.delivery_state !== "planned" || metadata.firstContactAttempt)) {
      throw new Error("Contato anterior ou envio incerto bloqueado. Revisão manual necessária. (Previous contact / uncertain attempt)");
    }
  }
  const previousJobs = database.sqlite.prepare(`SELECT payload_json FROM jobs WHERE type = 'send_browser_dm'
    AND (status IN ('retry','dead_letter') OR (attempts > 0 AND status IN ('pending','cancelled'))
      OR (status = 'running' AND (id != ? OR attempts > 1)))`).all(currentJobId) as Array<{ payload_json: string }>;
  for (const previous of previousJobs) {
    const payload = JSON.parse(previous.payload_json) as { leadId?: number };
    if (payload.leadId !== undefined && ids.has(payload.leadId)) throw new Error("Tentativa anterior com resultado incerto. Confira o Direct antes de revisão manual. (uncertain outcome)");
  }
  if (lead.channelOwner !== "browser" || lead.channelState !== "browser_contact_pending") throw new Error("Este contato não está disponível para uma primeira abordagem.");
}

function assertApiEligible(leadId: number): void {
  const { lead } = identity(leadId);
  if (lead.channelOwner !== "api" || lead.channelState !== "api_active" || !lead.instagramScopedId || !lead.lastInboundAt) throw new Error("Este contato ainda não pode receber uma resposta pela API.");
  if (Date.now() - lead.lastInboundAt.getTime() > 24 * 60 * 60_000) throw new Error("A janela de resposta de 24 horas expirou (expired).");
}

export function getMessageDraft(id: number): MessageDraft {
  validId(id);
  const draft = database.db.select().from(messageApprovals).where(eq(messageApprovals.id, id)).get();
  if (!draft) throw new Error("Mensagem não encontrada.");
  return draft;
}

function assertRevision(input: Revision, allowed: MessageDraft["status"][]): MessageDraft {
  validId(input.expectedVersion);
  const draft = getMessageDraft(input.id);
  if (draft.version !== input.expectedVersion || !allowed.includes(draft.status)) throw new Error("A mensagem mudou ou já foi processada. Atualize o painel e revise novamente.");
  return draft;
}

function assertRecipient(draft: MessageDraft): void {
  const { lead, handle } = identity(draft.leadId);
  if (handle !== draft.recipientHandle || lead.instagramScopedId !== draft.recipientScopedId) throw new Error("O destinatário mudou. Crie e revise uma nova mensagem.");
}

export function createMessageDraft(input: { leadId: number; channel: Channel; purpose: Purpose; body: string; reason?: string; sourceKey?: string }): MessageDraft {
  validateBody(input.body);
  const reason = input.reason ?? "Rascunho manual";
  validateReason(reason);
  if (!(input.channel === "browser" && input.purpose === "first_contact") && !(input.channel === "api" && ["reply", "follow_up"].includes(input.purpose))) throw new Error("Canal e tipo de mensagem incompatíveis.");
  if (input.sourceKey !== undefined && (typeof input.sourceKey !== "string" || input.sourceKey.length > 250)) throw new Error("Origem do rascunho inválida.");
  return database.sqlite.transaction(() => {
    if (input.sourceKey) {
      const existing = database.db.select().from(messageApprovals).where(eq(messageApprovals.sourceKey, input.sourceKey)).get();
      if (existing) return existing;
    }
    if (input.channel === "browser") assertFirstContactEligible(input.leadId);
    else assertApiEligible(input.leadId);
    const { lead, handle } = identity(input.leadId);
    return database.db.insert(messageApprovals).values({ leadId: lead.id, channel: input.channel, purpose: input.purpose,
      recipientHandle: handle, recipientScopedId: lead.instagramScopedId, body: input.body, reason, sourceKey: input.sourceKey }).returning().get();
  }).immediate();
}

export function saveMessageDraft(input: Revision & { body: string; reason?: string }): MessageDraft {
  validateBody(input.body);
  if (input.reason !== undefined) validateReason(input.reason);
  return database.sqlite.transaction(() => {
    const draft = assertRevision(input, ["pending"]);
    assertRecipient(draft);
    return database.db.update(messageApprovals).set({ body: input.body, reason: input.reason ?? draft.reason, directHistoryChecked: false,
      version: draft.version + 1, updatedAt: new Date() }).where(eq(messageApprovals.id, draft.id)).returning().get()!;
  }).immediate();
}

export function approveMessageDraft(input: Revision & { directHistoryChecked?: boolean }): MessageDraft {
  return database.sqlite.transaction(() => {
    const draft = assertRevision(input, ["pending"]);
    validateBody(draft.body, true);
    assertRecipient(draft);
    if (draft.channel === "browser") {
      if (input.directHistoryChecked !== true) throw new Error("Confirme no Direct que nunca enviamos mensagem a este contato.");
      assertFirstContactEligible(draft.leadId);
      const { ids } = identity(draft.leadId);
      const active = database.db.select().from(messageApprovals).all().some((item) => item.id !== draft.id && item.channel === "browser"
        && ids.has(item.leadId) && ["approved", "sending", "sent", "uncertain"].includes(item.status));
      if (active) throw new Error("Já existe uma primeira abordagem aprovada ou uma tentativa para este contato.");
    } else assertApiEligible(draft.leadId);
    const approved = database.db.update(messageApprovals).set({ status: "approved", directHistoryChecked: draft.channel === "browser",
      version: draft.version + 1, approvedAt: new Date(), updatedAt: new Date() }).where(eq(messageApprovals.id, draft.id)).returning().get()!;
    enqueueJob(draft.channel === "browser" ? "send_approved_browser" : "send_approved_api", { approvalId: approved.id, approvalVersion: approved.version }, { dedupeKey: `approved_message:${approved.id}:${approved.version}`, maxAttempts: 1, runAt: draft.channel === "browser" ? nextBrowserSendAt() : new Date() });
    return approved;
  }).immediate();
}

export function rejectMessageDraft(input: Revision): MessageDraft {
  return database.sqlite.transaction(() => {
    const draft = assertRevision(input, ["pending", "approved"]);
    return database.db.update(messageApprovals).set({ status: "rejected", version: draft.version + 1, updatedAt: new Date() }).where(eq(messageApprovals.id, draft.id)).returning().get()!;
  }).immediate();
}

export function listMessageDrafts() {
  return database.db.select({ draft: messageApprovals, displayName: leads.displayName, currentHandle: leads.instagramHandle })
    .from(messageApprovals).innerJoin(leads, eq(messageApprovals.leadId, leads.id)).orderBy(desc(messageApprovals.createdAt)).all()
    .map(({ draft, ...contact }) => ({ ...draft, ...contact }));
}

// Called inside the transport transaction, before any external side effect.
export function claimMessageApproval(input: { id?: number; leadId: number; channel: Channel; body: string }): MessageDraft {
  if (!input.id) throw new Error("Envio bloqueado: mensagem sem aprovação humana.");
  const draft = getMessageDraft(input.id);
  if (draft.status !== "approved" || !draft.approvedAt || draft.leadId !== input.leadId || draft.channel !== input.channel || draft.body !== input.body) throw new Error("Envio bloqueado: aprovação ausente, alterada ou já utilizada.");
  assertRecipient(draft);
  if (draft.channel === "browser" && !draft.directHistoryChecked) throw new Error("A conferência do histórico do Direct é obrigatória.");
  if (draft.channel === "api") assertApiEligible(draft.leadId);
  return database.db.update(messageApprovals).set({ status: "sending", version: draft.version + 1, updatedAt: new Date() })
    .where(eq(messageApprovals.id, draft.id)).returning().get()!;
}

export function finishMessageApproval(id: number, status: "sent" | "simulated" | "uncertain"): void {
  database.sqlite.prepare(`UPDATE message_approvals SET status = ?, version = version + 1, sent_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'`)
    .run(status, status === "sent" ? Date.now() : null, Date.now(), id);
}
