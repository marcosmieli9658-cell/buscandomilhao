// Node 24. Receives only: never starts a worker or changes delivery pauses.
// Configure RECEIVER_ORIGIN / RECEIVER_SYNC_TOKEN in .env.receiver-sync.local
// (already ignored by Git), or in the process environment. --once makes one bounded sweep.
import crypto from "node:crypto";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const maxRawBytes = 2 * 1024 * 1024;
const maxBatchBytes = 12 * 1024 * 1024;
const maxJsonBytes = 64 * 1024;

export class SyncError extends Error {
  constructor(code) { super(code); this.name = "SyncError"; this.code = code; }
}

function integer(value, fallback, min, max, code) {
  const result = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new SyncError(code);
  return result;
}

export function readConfig(env = process.env) {
  let remote;
  let local;
  try {
    remote = new URL(env.RECEIVER_ORIGIN);
    local = new URL(env.RECEIVER_LOCAL_ORIGIN || "http://127.0.0.1:3000");
  } catch { throw new SyncError("invalid_origin"); }
  if (remote.protocol !== "https:" || remote.username || remote.password || remote.search || remote.hash) throw new SyncError("receiver_requires_https");
  if (!["http:", "https:"].includes(local.protocol) || !["127.0.0.1", "[::1]", "localhost"].includes(local.hostname)
    || local.username || local.password || local.search || local.hash || local.pathname !== "/") throw new SyncError("local_requires_loopback_origin");
  const token = env.RECEIVER_SYNC_TOKEN;
  if (typeof token !== "string" || Buffer.byteLength(token) < 32 || /[\s\u0000-\u001f\u007f]/u.test(token)) throw new SyncError("invalid_sync_token");
  // A leading slash in new URL would discard /api/buscando-milhao.
  remote.pathname = `${remote.pathname.replace(/\/+$/, "")}/`;
  return Object.freeze({
    eventsUrl: new URL("sync/events", remote).href,
    ackUrl: new URL("sync/ack", remote).href,
    localUrl: new URL("/api/instagram/webhook", local).href,
    token,
    limit: integer(env.RECEIVER_SYNC_BATCH_SIZE, 25, 1, 100, "invalid_batch_size"),
    timeoutMs: integer(env.RECEIVER_SYNC_TIMEOUT_MS, 15_000, 100, 120_000, "invalid_timeout"),
    pollMs: integer(env.RECEIVER_SYNC_POLL_MS, 15_000, 1000, 300_000, "invalid_poll_interval"),
    pagesPerCycle: integer(env.RECEIVER_SYNC_PAGES_PER_CYCLE, 10, 1, 100, "invalid_page_budget"),
    backoffMs: 2000,
    maxBackoffMs: 60_000,
  });
}

async function jsonResponse(response, maxBytes, code) {
  if (response.status !== 200) throw new SyncError(`${code}_http_${response.status}`);
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new SyncError(`${code}_not_json`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new SyncError(`${code}_too_large`);
  if (!response.body) throw new SyncError(`${code}_empty`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new SyncError(`${code}_too_large`); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new SyncError(`${code}_invalid_json`); }
}

function requestSignal(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function requestJson(url, options, maxBytes, code, config, fetchImpl, signal) {
  try {
    const response = await fetchImpl(url, { ...options, redirect: "error", signal: requestSignal(config.timeoutMs, signal) });
    return await jsonResponse(response, maxBytes, code);
  } catch (error) {
    if (error instanceof SyncError) throw error;
    if (signal?.aborted) throw new SyncError("stopped");
    throw new SyncError(`${code}_unavailable`);
  }
}

export function decodeEvent(event) {
  if (!event || !Number.isSafeInteger(event.id) || event.id < 1 || typeof event.bodyBase64 !== "string"
    || !/^sha256=[a-f0-9]{64}$/i.test(event.signature || "") || !/^[a-f0-9]{64}$/i.test(event.sha256 || "")
    || typeof event.receivedAt !== "string" || !Number.isFinite(Date.parse(event.receivedAt))) throw new SyncError("invalid_event");
  if (event.bodyBase64.length > Math.ceil(maxRawBytes / 3) * 4 || event.bodyBase64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.bodyBase64)) throw new SyncError("invalid_event_body");
  const bytes = Buffer.from(event.bodyBase64, "base64");
  if (!bytes.length || bytes.length > maxRawBytes || bytes.toString("base64") !== event.bodyBase64
    || crypto.createHash("sha256").update(bytes).digest("hex") !== event.sha256.toLowerCase()) throw new SyncError("event_hash_mismatch");
  let payload;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new SyncError("invalid_event_json"); }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.entry)) throw new SyncError("invalid_event_payload");
  const entries = payload.entry.flatMap((entry) => {
    if (!entry || (entry.messaging !== undefined && !Array.isArray(entry.messaging))) throw new SyncError("invalid_event_payload");
    return entry.messaging ?? [];
  });
  const expected = entries.filter((entry) => entry?.message && !entry.message.is_echo &&
    ((typeof entry.message.text === "string" && entry.message.text.length > 0)
      || (Array.isArray(entry.message.attachments) && entry.message.attachments.length > 0))).length;
  return { bytes, expected };
}

export async function syncOnce(config, { fetchImpl = fetch, log = () => {}, signal, afterId = 0 } = {}) {
  if (!Number.isSafeInteger(afterId) || afterId < 0) throw new SyncError("invalid_cursor");
  const headers = { authorization: `Bearer ${config.token}`, accept: "application/json" };
  const eventsUrl = new URL(config.eventsUrl);
  eventsUrl.searchParams.set("limit", String(config.limit));
  if (afterId) eventsUrl.searchParams.set("afterId", String(afterId));
  const batch = await requestJson(eventsUrl.href, { headers, cache: "no-store" }, maxBatchBytes, "receiver", config, fetchImpl, signal);
  if (!batch || !Array.isArray(batch.events) || batch.events.length > config.limit || typeof batch.hasMore !== "boolean"
    || batch.events.some((event, index) => !Number.isSafeInteger(event?.id) || event.id <= (index ? batch.events[index - 1].id : afterId))
    || new Set(batch.events.map((event) => event.id)).size !== batch.events.length) throw new SyncError("invalid_batch");
  if (batch.hasMore && batch.events.length === 0) throw new SyncError("cursor_did_not_advance");
  const result = { fetched: batch.events.length, acknowledged: 0, failed: 0, hasMore: batch.hasMore,
    nextAfterId: batch.events.at(-1)?.id ?? afterId };
  for (const event of batch.events) {
    if (signal?.aborted) throw new SyncError("stopped");
    try {
      const { bytes, expected } = decodeEvent(event);
      const local = await requestJson(config.localUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": event.signature },
        body: bytes,
      }, maxJsonBytes, "local", config, fetchImpl, signal);
      if (!local || local.ok !== true || (local.failed !== undefined && local.failed !== 0)
        || !Number.isSafeInteger(local.received) || local.received < 0 || !Number.isSafeInteger(local.duplicates) || local.duplicates < 0
        || local.received + local.duplicates !== expected) throw new SyncError("local_not_fully_processed");
      const ack = await requestJson(config.ackUrl, {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ ids: [event.id] }),
      }, maxJsonBytes, "ack", config, fetchImpl, signal);
      if (!ack || ack.ok !== true || !Array.isArray(ack.ackedIds) || !Array.isArray(ack.alreadyAckedIds)
        || ack.ackedIds.length + ack.alreadyAckedIds.length !== 1
        || ![...ack.ackedIds, ...ack.alreadyAckedIds].includes(event.id)) throw new SyncError("ack_not_confirmed");
      result.acknowledged += 1;
      log({ type: "event_acknowledged", id: event.id });
    } catch (error) {
      if (signal?.aborted) throw new SyncError("stopped");
      result.failed += 1;
      log({ type: "event_retained", id: event.id, code: error instanceof SyncError ? error.code : "unexpected_failure" });
    }
  }
  return result;
}

export async function runSync(config, { once = false, fetchImpl = fetch, log = () => {}, signal, sleepImpl = delay } = {}) {
  let failures = 0;
  let afterId = 0;
  while (!signal?.aborted) {
    let cycleFailed = false;
    let hasMore = false;
    for (let page = 0; page < config.pagesPerCycle && !signal?.aborted; page += 1) {
      try {
        const result = await syncOnce(config, { fetchImpl, log, signal, afterId });
        cycleFailed ||= result.failed > 0;
        hasMore = result.hasMore;
        // Poison events remain durable, but cannot hide a later valid event.
        afterId = result.hasMore ? result.nextAfterId : 0;
        log({ type: "batch", ...result });
        if (!result.hasMore) break;
      } catch (error) {
        if (signal?.aborted) return 0;
        cycleFailed = true;
        log({ type: "sync_retry", code: error instanceof SyncError ? error.code : "unexpected_failure", nextAfterId: afterId });
        break;
      }
    }
    if (once) {
      if (hasMore) log({ type: "page_budget_reached", nextAfterId: afterId });
      return cycleFailed || hasMore ? 1 : 0;
    }
    failures = cycleFailed ? failures + 1 : 0;
    const waitMs = failures ? Math.min(config.maxBackoffMs, config.backoffMs * 2 ** Math.min(failures - 1, 10))
      : hasMore ? 250 : config.pollMs;
    try { await sleepImpl(waitMs, undefined, { signal }); }
    catch { if (signal?.aborted) return 0; throw new SyncError("wait_failed"); }
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("node scripts/sync-inbound.mjs [--once]\nConfig: .env.receiver-sync.local (ignored), RECEIVER_ORIGIN, RECEIVER_SYNC_TOKEN. Receives only; no sends or worker.");
    return;
  }
  if (args.some((arg) => arg !== "--once")) throw new SyncError("invalid_argument");
  try { loadEnvFile(new URL("../.env.receiver-sync.local", import.meta.url)); }
  catch (error) { if (error.code !== "ENOENT") throw new SyncError("config_file_unreadable"); }
  const config = readConfig();
  const controller = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => controller.abort());
  process.exitCode = await runSync(config, {
    once: args.includes("--once"), signal: controller.signal,
    log: (item) => console.log(JSON.stringify({ time: new Date().toISOString(), ...item })),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ type: "sync_stopped", code: error instanceof SyncError ? error.code : "configuration_failed" }));
    process.exitCode = 1;
  });
}
