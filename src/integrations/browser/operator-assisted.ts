import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { database } from "@/db/client";
import { assertFirstContactEligible, getMessageDraft } from "@/features/approvals/service";
import { normalizeInstagramHandle } from "@/features/leads/service";
import { getBusinessConfig } from "@/lib/business";
import { getEnv } from "@/lib/env";
import { handleJob } from "@/worker/handlers";
import { completeJob, failJob, type DurableJob } from "@/worker/queue";
import { instagramRequestsDisabledErrors, type BrowserGateway } from "./gateway";
import { getZonedTimeParts } from "./scheduling";

const sender = "@agenciablessialabs";
const selectionSchema = z.object({ approvalId: z.number().int().positive(), approvalVersion: z.number().int().positive(), jobId: z.number().int().positive() }).strict();
export type AssistedSelection = z.infer<typeof selectionSchema>;
export interface AssistedRequest extends AssistedSelection {
  nonce: string;
  sender: string;
  recipientHandle: string;
  body: string;
  bodySha256: string;
  createdAt: string;
  expiresAt: string;
}
const acknowledgementBinding = selectionSchema.extend({
  nonce: z.string().regex(/^[a-f0-9]{64}$/), sender: z.literal(sender), recipientHandle: z.string(),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/), threadUrl: z.string().url(), proofPath: z.string().min(1),
  confirmedAt: z.string().datetime(),
}).strict();
const acknowledgementSchema = z.union([
  acknowledgementBinding.extend({ outcome: z.literal("sent").optional(), confirmedVisible: z.literal(true) }).strict(),
  acknowledgementBinding.extend({ outcome: z.literal("blocked"), reasonCode: z.literal("instagram_new_message_requests_disabled"), observedError: z.enum(instagramRequestsDisabledErrors) }).strict(),
]);

type PauseSnapshot = { globally_paused: number; browser_queue_paused: number; pause_reason: string | null; browser_pause_reason: string | null };
type JobRow = { id: number; type: string; status: string; payload_json: string; attempts: number; max_attempts: number; run_at: number };

function inside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export function validateAssistedAcknowledgement(value: unknown, request: AssistedRequest, proofRoots: string[], now = Date.now()) {
  const ack = acknowledgementSchema.parse(value);
  if (now >= Date.parse(request.expiresAt)) throw new Error("A confirmação expirou. Não repita o envio; confira o Direct.");
  for (const key of ["nonce", "sender", "recipientHandle", "bodySha256", "approvalId", "approvalVersion", "jobId"] as const) {
    if (ack[key] !== request[key]) throw new Error(`Confirmação não corresponde ao pedido: ${key}.`);
  }
  const thread = new URL(ack.threadUrl);
  if (thread.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(thread.hostname)
    || thread.username || thread.password || thread.search || thread.hash || !/^\/direct\/t\/[A-Za-z0-9_-]+\/$/.test(thread.pathname)) {
    throw new Error("A confirmação exige a URL exata da conversa no Instagram.");
  }
  const confirmedAt = Date.parse(ack.confirmedAt);
  if (confirmedAt < Date.parse(request.createdAt) || confirmedAt > now + 1_000) throw new Error("Horário da confirmação inválido.");
  if (!path.isAbsolute(ack.proofPath) || !proofRoots.some((root) => inside(root, ack.proofPath))) throw new Error("A prova deve estar nos artefatos locais desta operação.");
  const proof = fs.realpathSync(ack.proofPath);
  if (!proofRoots.some((root) => inside(fs.realpathSync(root), proof))) throw new Error("O destino real da prova está fora dos artefatos locais.");
  const stat = fs.statSync(proof);
  if (!stat.isFile() || stat.size === 0 || stat.mtimeMs < Date.parse(request.createdAt) - 1_000 || !/\.(png|jpe?g|webp)$/i.test(proof)) {
    throw new Error("É necessária uma captura nova e não vazia da mensagem enviada.");
  }
  return { ...ack, proofPath: proof, proofSha256: crypto.createHash("sha256").update(fs.readFileSync(proof)).digest("hex") };
}

function inspectSelection(input: AssistedSelection): { job: JobRow; draft: ReturnType<typeof getMessageDraft> } {
  selectionSchema.parse(input);
  const draft = getMessageDraft(input.approvalId);
  if (draft.status !== "approved" || draft.version !== input.approvalVersion || !draft.approvedAt
    || draft.channel !== "browser" || draft.purpose !== "first_contact" || !draft.directHistoryChecked) {
    throw new Error("Aprovação ausente, alterada ou sem conferência do Direct.");
  }
  const lead = database.sqlite.prepare("SELECT instagram_handle, instagram_scoped_id FROM leads WHERE id = ?").get(draft.leadId) as { instagram_handle: string; instagram_scoped_id: string | null } | undefined;
  if (!lead || normalizeInstagramHandle(lead.instagram_handle) !== draft.recipientHandle || lead.instagram_scoped_id !== draft.recipientScopedId) throw new Error("O destinatário mudou após a aprovação.");
  assertFirstContactEligible(draft.leadId, input.jobId);
  const job = database.sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(input.jobId) as JobRow | undefined;
  if (!job || job.type !== "send_approved_browser" || job.status !== "pending" || job.attempts !== 0 || job.max_attempts !== 1 || job.run_at > Date.now()) {
    throw new Error("O job indicado não está disponível para sua primeira execução agora.");
  }
  const payload: unknown = JSON.parse(job.payload_json);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || (payload as Record<string, unknown>).approvalId !== input.approvalId
    || (payload as Record<string, unknown>).approvalVersion !== input.approvalVersion) throw new Error("O job não corresponde à aprovação e versão indicadas.");
  return { job, draft };
}

export function claimExactAssistedJob(input: AssistedSelection, lockOwner: string): DurableJob {
  return database.sqlite.transaction(() => {
    const { job } = inspectSelection(input);
    if ((database.sqlite.prepare("SELECT count(*) n FROM jobs WHERE status = 'running'").get() as { n: number }).n !== 0) throw new Error("Existe outro job em execução. A operação assistida exige fila ociosa.");
    const updated = database.sqlite.prepare(`UPDATE jobs SET status = 'running', attempts = 1, locked_by = ?, locked_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending' AND attempts = 0 AND run_at <= ?`)
      .run(lockOwner, Date.now(), Date.now(), job.id, Date.now());
    if (updated.changes !== 1) throw new Error("O job mudou durante a seleção.");
    return { id: job.id, type: job.type, payload: JSON.parse(job.payload_json), attempts: 1, maxAttempts: 1 };
  }).immediate();
}

function pauseSnapshot(): PauseSnapshot {
  const value = database.sqlite.prepare("SELECT globally_paused, browser_queue_paused, pause_reason, browser_pause_reason FROM system_settings WHERE id = 1").get() as PauseSnapshot | undefined;
  if (!value || value.globally_paused !== 1 || value.browser_queue_paused !== 1) throw new Error("A operação assistida exige as duas filas pausadas antes de começar.");
  return value;
}

export interface AssistedOptions {
  assertNoWorker: () => Promise<void>;
  exchange: (request: AssistedRequest, files: { requestPath: string; ackPath: string }, signal?: AbortSignal) => Promise<unknown>;
  artifactRoot?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function runAssistedSend(input: AssistedSelection, options: AssistedOptions): Promise<"sent" | "deferred" | "blocked"> {
  selectionSchema.parse(input);
  if (getEnv().DRY_RUN) throw new Error("O processo assistido exige DRY_RUN=false somente neste processo.");
  if (normalizeInstagramHandle(getBusinessConfig().instagramHandle) !== sender) throw new Error("Remetente comercial diferente de @agenciablessialabs.");
  await options.assertNoWorker();
  options.signal?.throwIfAborted();
  inspectSelection(input);
  const previousPause = pauseSnapshot();
  const artifactRoot = path.resolve(options.artifactRoot ?? "logs/operator-assisted");
  fs.mkdirSync(artifactRoot, { recursive: true });
  const nonce = crypto.randomBytes(32).toString("hex");
  const basename = `approval-${input.approvalId}-v${input.approvalVersion}-job-${input.jobId}-${nonce}`;
  const recoveryPath = path.join(artifactRoot, `${basename}.recovery.json`);
  const requestPath = path.join(artifactRoot, `${basename}.request.json`);
  const ackPath = path.join(artifactRoot, `${basename}.ack.json`);
  const marker = `operator_assisted:${nonce}`;
  let job: DurableJob | undefined;
  let restored = false;
  let phase = "prepared";
  const recovery = () => fs.writeFileSync(recoveryPath, JSON.stringify({ ...input, nonce, pid: process.pid, phase, previousPause, pausesRestored: restored,
    requestPath, ackPath, updatedAt: new Date().toISOString(), recovery: "Após interrupção, manter ambas as filas pausadas. Não repetir o envio nem reabrir o job: conferir Direct e reserva antes de intervenção manual." }, null, 2));
  const restorePauses = () => {
    // Do not overwrite a newer pause reason chosen by an operator or integration.
    database.sqlite.prepare(`UPDATE system_settings SET globally_paused = 1, pause_reason = ?, updated_at = ? WHERE id = 1 AND globally_paused = 0 AND pause_reason = ?`)
      .run(previousPause.pause_reason, Date.now(), marker);
    database.sqlite.prepare(`UPDATE system_settings SET browser_queue_paused = 1, browser_pause_reason = ?, updated_at = ? WHERE id = 1 AND browser_queue_paused = 0 AND browser_pause_reason = ?`)
      .run(previousPause.browser_pause_reason, Date.now(), marker);
    const current = database.sqlite.prepare("SELECT globally_paused, browser_queue_paused FROM system_settings WHERE id = 1").get() as PauseSnapshot;
    restored = current.globally_paused === 1 && current.browser_queue_paused === 1;
    recovery();
    if (!restored) throw new Error("As pausas mudaram fora desta operação. Confira o painel imediatamente.");
  };
  recovery(); // Durable recovery instructions precede the temporary pause change.
  try {
    job = claimExactAssistedJob(input, marker);
    const paused = database.sqlite.prepare(`UPDATE system_settings SET globally_paused = 0, browser_queue_paused = 0,
      pause_reason = ?, browser_pause_reason = ?, updated_at = ? WHERE id = 1 AND globally_paused = 1 AND browser_queue_paused = 1
        AND pause_reason IS ? AND browser_pause_reason IS ?`)
      .run(marker, marker, Date.now(), previousPause.pause_reason, previousPause.browser_pause_reason);
    if (paused.changes !== 1) throw new Error("As pausas mudaram antes da reserva.");
    const gateway: BrowserGateway = {
      async sendFirstMessage(request) {
        // handleJob -> sendFirstContact reserves synchronously. Pause again before any wait or UI operation.
        restorePauses();
        if (request.dryRun || request.jobId !== input.jobId) throw new Error("Pedido assistido incompatível com a execução explícita.");
        options.signal?.throwIfAborted();
        await options.assertNoWorker();
        const createdAt = new Date();
        const env = getEnv();
        const local = getZonedTimeParts(createdAt, env.OPERATING_TIMEZONE);
        const end = env.OPERATING_HOURS.split("-")[1].split(":").map(Number);
        const remainingWindow = ((end[0] * 60 + end[1] + 1) - (Number(local.hour) * 60 + Number(local.minute))) * 60_000 - createdAt.getSeconds() * 1000 - createdAt.getMilliseconds();
        const timeoutMs = Math.min(options.timeoutMs ?? 240_000, 300_000, remainingWindow);
        if (timeoutMs <= 0) throw new Error("O horário permitido terminou antes da conferência.");
        const assisted: AssistedRequest = { ...input, nonce, sender, recipientHandle: normalizeInstagramHandle(request.handle), body: request.message,
          bodySha256: crypto.createHash("sha256").update(request.message).digest("hex"), createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + timeoutMs).toISOString() };
        fs.writeFileSync(requestPath, JSON.stringify(assisted, null, 2), { flag: "wx" });
        phase = "waiting_ack";
        recovery();
        const combinedSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
        const raw = await options.exchange(assisted, { requestPath, ackPath }, combinedSignal);
        combinedSignal.throwIfAborted();
        const proofRoots = [artifactRoot, path.resolve("screenshots")].filter((root) => fs.existsSync(root));
        const ack = validateAssistedAcknowledgement(raw, assisted, proofRoots);
        // Persist the exact evidence accepted by the transport, without inventing a delivery receipt.
        fs.writeFileSync(path.join(artifactRoot, `${basename}.accepted.json`), JSON.stringify(ack, null, 2), { flag: "wx" });
        if (ack.outcome === "blocked") {
          return { sent: false, dryRun: false, url: ack.threadUrl,
            blocked: { reasonCode: ack.reasonCode, observedError: ack.observedError, proofPath: ack.proofPath, proofSha256: ack.proofSha256 } };
        }
        return { sent: true, dryRun: false, url: ack.threadUrl };
      },
    };
    await handleJob(job, { browserGateway: gateway, conversationEngine: {
      generateFirstContact: async () => { throw new Error("A ponte não gera textos."); },
      decideNextAction: async () => { throw new Error("A ponte não processa outras conversas."); },
    } });
    const draft = getMessageDraft(input.approvalId);
    if (draft.status === "rejected") {
      const current = database.sqlite.prepare("SELECT status FROM jobs WHERE id = ?").get(job.id) as { status: string };
      if (current.status !== "dead_letter") throw new Error("A recusa não foi registrada como tentativa terminal.");
      phase = "blocked";
      return "blocked";
    }
    if (draft.status === "approved") {
      const current = database.sqlite.prepare("SELECT status, attempts FROM jobs WHERE id = ?").get(job.id) as { status: string; attempts: number };
      if (current.status !== "pending" || current.attempts !== 0) throw new Error("O envio não foi confirmado nem adiado com segurança.");
      phase = "deferred";
      return "deferred";
    }
    if (draft.status !== "sent") throw new Error("O envio não tem confirmação persistida.");
    completeJob(job.id);
    phase = "sent";
    return "sent";
  } catch (error) {
    phase = getMessageDraft(input.approvalId).status === "uncertain" ? "uncertain" : "blocked";
    if (job) failJob(job, error); // maxAttempts=1: never authorizes an automatic retry.
    throw error;
  } finally {
    restorePauses();
  }
}

export async function waitForAssistedAcknowledgement(request: AssistedRequest, files: { requestPath: string; ackPath: string }, signal?: AbortSignal): Promise<unknown> {
  while (Date.now() < Date.parse(request.expiresAt)) {
    signal?.throwIfAborted();
    if (fs.existsSync(files.ackPath)) return JSON.parse(fs.readFileSync(files.ackPath, "utf8"));
    await delay(500, undefined, { signal });
  }
  throw new Error("Confirmação não recebida no prazo. Resultado incerto, sem repetição automática.");
}
