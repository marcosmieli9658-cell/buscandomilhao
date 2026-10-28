// Node 24. Post-deployment checks only: no CRM, worker, outbound API or ACK.
// Default/--check makes read-only checks plus one deliberately invalid POST ({}).
// --probe additionally stores exactly one signed, empty Instagram event and leaves
// it pending. Keep sync stopped, restart the receiver, then use --check --probe-id
// <printed UUID> to verify persistence without inserting another event.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const prefix = "/api/buscando-milhao";
const appKeys = ["INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_PRODUCT_APP_SECRET"];
const syncKeys = ["RECEIVER_ORIGIN", "RECEIVER_SYNC_TOKEN"];
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const maxBatchBytes = 12 * 1024 * 1024;

export class VerificationError extends Error {
  constructor(code) { super(code); this.name = "VerificationError"; this.code = code; }
}

// Only allowlisted, single-line assignments are parsed. Outbound credentials are
// not imported into process.env or included in the returned configuration.
function selectedFileEnvironment(filename, keys) {
  let raw;
  try { raw = fs.readFileSync(filename, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw new VerificationError("config_file_unreadable");
  }
  const selected = raw.split(/\r?\n/).filter(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return match && keys.includes(match[1]);
  });
  try { return parseEnv(selected.join("\n")); }
  catch { throw new VerificationError("invalid_config_file"); }
}

export function readConfig(env) {
  let origin;
  try { origin = new URL(env.RECEIVER_ORIGIN); }
  catch { throw new VerificationError("invalid_receiver_origin"); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash
    || origin.pathname.replace(/\/+$/, "") !== prefix) throw new VerificationError("receiver_requires_https_canonical_prefix");
  origin.pathname = `${prefix}/`;
  const verifyToken = env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  const appSecrets = [...new Set([env.INSTAGRAM_APP_SECRET, env.INSTAGRAM_PRODUCT_APP_SECRET].filter(Boolean))];
  const syncToken = env.RECEIVER_SYNC_TOKEN;
  if (typeof verifyToken !== "string" || !verifyToken || /[\r\n\u0000]/u.test(verifyToken)) throw new VerificationError("invalid_verify_token");
  if (!appSecrets.length || appSecrets.some(secret => typeof secret !== "string" || /[\r\n\u0000]/u.test(secret))) throw new VerificationError("invalid_app_secret");
  if (typeof syncToken !== "string" || Buffer.byteLength(syncToken) < 32 || /[\s\u0000-\u001f\u007f]/u.test(syncToken)
    || [verifyToken, ...appSecrets].includes(syncToken)) throw new VerificationError("invalid_independent_sync_token");
  return Object.freeze({
    webhookUrl: new URL("webhook", origin).href,
    healthUrl: new URL("healthz", origin).href,
    eventsUrl: new URL("sync/events", origin).href,
    verifyToken, appSecrets, syncToken, timeoutMs: 15_000, maxPages: 100,
  });
}

export function loadConfig(root = projectRoot, environment = process.env) {
  const selected = {
    ...selectedFileEnvironment(path.join(root, ".env"), appKeys),
    ...selectedFileEnvironment(path.join(root, ".env.receiver-sync.local"), syncKeys),
  };
  for (const key of [...appKeys, ...syncKeys]) if (environment[key] !== undefined) selected[key] = environment[key];
  return readConfig(selected);
}

export function probeBody(probeId) {
  if (!uuidPattern.test(probeId)) throw new VerificationError("invalid_probe_id");
  return Buffer.from(JSON.stringify({ object: "instagram", entry: [], verification_id: `receiver-verification-${probeId.toLowerCase()}` }));
}

function signature(body, secret) { return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`; }

async function request(config, url, options, expectedStatus, maxBytes, code, fetchImpl) {
  try {
    const response = await fetchImpl(url, { ...options, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(config.timeoutMs) });
    if (response.status !== expectedStatus) {
      await response.body?.cancel();
      throw new VerificationError(`${code}_unexpected_http_${response.status}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel();
      throw new VerificationError(`${code}_response_too_large`);
    }
    const chunks = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw new VerificationError(`${code}_response_too_large`); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
    }
    return { body: Buffer.concat(chunks), contentType: response.headers.get("content-type") || "" };
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    // Never log fetch errors: they may contain URLs, headers or query tokens.
    throw new VerificationError(`${code}_unavailable`);
  }
}

function parseJson(response, code) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.contentType)) throw new VerificationError(`${code}_not_json`);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)); }
  catch { throw new VerificationError(`${code}_invalid_json`); }
}

async function getBatch(config, afterId, fetchImpl) {
  const url = new URL(config.eventsUrl);
  url.searchParams.set("limit", "100");
  url.searchParams.set("afterId", String(afterId));
  const response = await request(config, url.href, { headers: { authorization: `Bearer ${config.syncToken}`, accept: "application/json" } }, 200, maxBatchBytes, "authenticated_sync", fetchImpl);
  const result = parseJson(response, "authenticated_sync");
  if (!result || !Array.isArray(result.events) || result.events.length > 100 || typeof result.hasMore !== "boolean"
    || (result.hasMore && !result.events.length)
    || result.events.some((event, index) => !Number.isSafeInteger(event?.id) || event.id <= (index ? result.events[index - 1].id : afterId))) throw new VerificationError("invalid_sync_batch");
  return result;
}

export async function findProbe(config, probeId, { fetchImpl = fetch } = {}) {
  const expected = probeBody(probeId);
  const expectedHash = crypto.createHash("sha256").update(expected).digest("hex");
  let afterId = 0;
  for (let page = 0; page < config.maxPages; page += 1) {
    const batch = await getBatch(config, afterId, fetchImpl);
    const found = batch.events.find(event => event.sha256 === expectedHash);
    if (found) {
      // Unrelated raw payloads are neither decoded nor logged.
      if (found.bodyBase64 !== expected.toString("base64") || !config.appSecrets.some(secret => signature(expected, secret) === found.signature)
        || typeof found.receivedAt !== "string" || !Number.isFinite(Date.parse(found.receivedAt))) throw new VerificationError("probe_bytes_or_signature_mismatch");
      return found.id;
    }
    if (!batch.hasMore) throw new VerificationError("probe_not_pending");
    afterId = batch.events.at(-1).id;
  }
  throw new VerificationError("probe_search_page_limit");
}

export async function verifyReceiver(config, { mode = "check", probeId, fetchImpl = fetch, log = () => {} } = {}) {
  if (!["check", "probe"].includes(mode) || (mode === "probe" && probeId !== undefined)) throw new VerificationError("invalid_mode");
  if (probeId !== undefined) probeBody(probeId);
  const challenge = `receiver-check-${crypto.randomUUID()}`;
  const verificationUrl = new URL(config.webhookUrl);
  verificationUrl.searchParams.set("hub.mode", "subscribe");
  verificationUrl.searchParams.set("hub.challenge", challenge);
  let badToken = `invalid-${crypto.randomUUID()}`;
  while (badToken === config.verifyToken) badToken = `invalid-${crypto.randomUUID()}`;
  verificationUrl.searchParams.set("hub.verify_token", badToken);
  await request(config, verificationUrl.href, {}, 403, 16_384, "bad_verify_token", fetchImpl);
  log({ type: "check_passed", check: "bad_verify_token_403" });
  verificationUrl.searchParams.set("hub.verify_token", config.verifyToken);
  const verified = await request(config, verificationUrl.href, {}, 200, 2048, "valid_challenge", fetchImpl);
  if (verified.body.toString("utf8") !== challenge) throw new VerificationError("challenge_mismatch");
  log({ type: "check_passed", check: "valid_challenge_200" });
  // {} also fails payload validation if a faulty deployment skips HMAC checking.
  await request(config, config.webhookUrl, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${"0".repeat(64)}` }, body: "{}" }, 401, 16_384, "bad_signature", fetchImpl);
  log({ type: "check_passed", check: "bad_signature_401" });
  await request(config, config.healthUrl, {}, 404, 16_384, "hidden_health", fetchImpl);
  log({ type: "check_passed", check: "hidden_health_404" });
  await request(config, config.eventsUrl, {}, 401, 16_384, "unauthenticated_sync", fetchImpl);
  log({ type: "check_passed", check: "unauthenticated_sync_401" });
  await getBatch(config, 0, fetchImpl);
  log({ type: "check_passed", check: "authenticated_sync_200" });
  if (mode === "probe") {
    probeId = crypto.randomUUID();
    const body = probeBody(probeId);
    // Print/store the non-PII identifier before POST: an uncertain response can
    // later be checked by ID without accidentally creating another event.
    log({ type: "probe_prepared", probeId });
    const response = await request(config, config.webhookUrl, {
      method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature(body, config.appSecrets[0]) }, body,
    }, 200, 16_384, "probe_post", fetchImpl);
    const result = parseJson(response, "probe_post");
    if (!result || result.ok !== true || typeof result.duplicate !== "boolean") throw new VerificationError("probe_not_confirmed");
    log({ type: "check_passed", check: "empty_probe_accepted_200", probeId });
  }
  if (probeId !== undefined) {
    const eventId = await findProbe(config, probeId, { fetchImpl });
    log({ type: "probe_pending_verified", probeId, eventId, ackSent: false });
    return { ok: true, probeId, eventId, ackSent: false };
  }
  return { ok: true, ackSent: false };
}

function parseArgs(args) {
  let mode = "check";
  let explicitMode = false;
  let probeId;
  for (let i = 0; i < args.length; i += 1) {
    if (["--check", "--probe"].includes(args[i]) && !explicitMode) { mode = args[i].slice(2); explicitMode = true; }
    else if (args[i] === "--probe-id" && probeId === undefined && args[i + 1]) { probeId = args[++i]; probeBody(probeId); }
    else throw new VerificationError("invalid_argument");
  }
  if (mode === "probe" && probeId !== undefined) throw new VerificationError("probe_id_requires_check");
  return { mode, probeId };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(`node scripts/verify-receiver.mjs [--check | --probe] [--probe-id UUID]
Default --check: GET checks and rejected POST {}, no persisted event.
--probe: additionally stores ONE signed event {object:"instagram",entry:[],verification_id:"receiver-verification-<UUID>"}; no message, CRM write, outbound call or ACK.
Keep sync stopped, restart receiver, then run --check --probe-id UUID to verify the same pending bytes/hash. No event is acknowledged by this tool.
Reads only verify token/app secrets from .env and RECEIVER_ORIGIN/RECEIVER_SYNC_TOKEN from .env.receiver-sync.local (allowlisted process variables override).
RECEIVER_ORIGIN must be https://<host>/api/buscando-milhao. Sanitized dated JSONL logs go to logs/.`);
    return;
  }
  const options = parseArgs(args);
  const directory = path.join(projectRoot, "logs");
  fs.mkdirSync(directory, { recursive: true });
  const filename = `receiver-verification-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.jsonl`;
  const fd = fs.openSync(path.join(directory, filename), "wx", 0o600);
  const log = item => {
    const line = JSON.stringify({ time: new Date().toISOString(), ...item });
    fs.writeSync(fd, `${line}\n`);
    fs.fsyncSync(fd);
    console.log(line);
  };
  try {
    log({ type: "verification_started", mode: options.mode, logFile: `logs/${filename}` });
    const result = await verifyReceiver(loadConfig(), { ...options, log });
    log({ type: "verification_complete", ...result });
  } catch (error) {
    log({ type: "verification_failed", code: error instanceof VerificationError ? error.code : "verification_unavailable" });
    process.exitCode = 1;
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ type: "verification_failed", code: error instanceof VerificationError ? error.code : "verification_unavailable" }));
    process.exitCode = 1;
  });
}
