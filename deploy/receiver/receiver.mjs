import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_ACK_BYTES = 16 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function digest(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function equalSecret(actual, expected) {
  return typeof actual === "string" && crypto.timingSafeEqual(digest(actual), digest(expected));
}

function validSignature(body, signature, secrets) {
  if (typeof signature !== "string" || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const received = Buffer.from(signature.slice(7), "hex");
  return secrets.map(secret => crypto.timingSafeEqual(
    received, crypto.createHmac("sha256", secret).update(body).digest(),
  )).includes(true);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit) {
  if (Number(request.headers["content-length"]) > limit) {
    request.resume();
    throw Object.assign(new Error("payload_too_large"), { status: 413 });
  }
  let size = 0;
  const chunks = [];
  // Event listeners allow a clean 413 without the async iterator destroying the socket.
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      request.removeListener("data", onData);
      request.resume();
      reject(error);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) return fail(Object.assign(new Error("payload_too_large"), { status: 413 }));
      chunks.push(chunk);
    };
    request.on("data", onData);
    request.on("error", () => fail(new Error("body_read_failed")));
    request.on("aborted", () => fail(new Error("body_aborted")));
    request.on("end", () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks, size));
    });
  });
}

function jsonBody(raw) {
  try { return JSON.parse(utf8.decode(raw)); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

function validMetaPayload(value) {
  return value && !Array.isArray(value) && typeof value === "object"
    && ["instagram", "page"].includes(value.object)
    && Array.isArray(value.entry)
    && value.entry.every(entry => entry && !Array.isArray(entry) && typeof entry === "object");
}

export function createReceiver({ dbPath, verifyToken, appSecrets, syncToken, logger = () => {} }) {
  if (!dbPath || dbPath === ":memory:" || !path.isAbsolute(dbPath)) throw new Error("absolute_persistent_db_path_required");
  if (typeof verifyToken !== "string" || !verifyToken || /[\r\n]/.test(verifyToken)) throw new Error("verify_token_required");
  const secrets = [...new Set((appSecrets ?? []).filter(secret => typeof secret === "string" && secret.length > 0))];
  if (!secrets.length || secrets.some(secret => /[\r\n]/.test(secret))) throw new Error("app_secret_required");
  if (typeof syncToken !== "string" || Buffer.byteLength(syncToken) < 32 || /[\r\n\s]/.test(syncToken)) throw new Error("independent_sync_token_required");
  if ([verifyToken, ...secrets].some(secret => equalSecret(syncToken, secret))) throw new Error("sync_token_must_be_independent");

  const directory = path.dirname(dbPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Use a dedicated StateDirectory, never a directory shared with another application.
  if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  const sqlite = new DatabaseSync(dbPath);
  try {
    if (process.platform !== "win32") fs.chmodSync(dbPath, 0o600);
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS receiver_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sha256 TEXT NOT NULL UNIQUE,
        raw_body BLOB NOT NULL,
        signature TEXT NOT NULL,
        received_at TEXT NOT NULL,
        acked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS receiver_pending ON receiver_events(acked_at, id);
    `);
    for (const suffix of ["-wal", "-shm"]) {
      if (process.platform !== "win32" && fs.existsSync(dbPath + suffix)) fs.chmodSync(dbPath + suffix, 0o600);
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }
  const insert = sqlite.prepare("INSERT INTO receiver_events(sha256,raw_body,signature,received_at) VALUES(?,?,?,?) ON CONFLICT(sha256) DO NOTHING");
  const pending = sqlite.prepare("SELECT id,sha256,raw_body,signature,received_at FROM receiver_events WHERE acked_at IS NULL AND id > ? ORDER BY id LIMIT ?");
  const laterPending = sqlite.prepare("SELECT 1 FROM receiver_events WHERE acked_at IS NULL AND id > ? LIMIT 1");
  const byId = sqlite.prepare("SELECT id,acked_at FROM receiver_events WHERE id=?");
  const ack = sqlite.prepare("UPDATE receiver_events SET acked_at=? WHERE id=? AND acked_at IS NULL");
  let closed = false;

  function isAuthorized(request) {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
    return equalSecret(authorization.slice(7), syncToken);
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/healthz" && request.method === "GET") {
        sqlite.prepare("SELECT 1").get();
        return sendJson(response, 200, { ok: true });
      }
      if (url.pathname === "/webhook" && request.method === "GET") {
        const challenge = url.searchParams.get("hub.challenge");
        if (url.searchParams.get("hub.mode") !== "subscribe" || !challenge
          || Buffer.byteLength(challenge) > 1024
          || !equalSecret(url.searchParams.get("hub.verify_token"), verifyToken)) {
          return sendJson(response, 403, { error: "verification_refused" });
        }
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return response.end(challenge);
      }
      if (url.pathname === "/webhook" && request.method === "POST") {
        const raw = await readBody(request, MAX_BODY_BYTES);
        const signature = request.headers["x-hub-signature-256"];
        if (!validSignature(raw, signature, secrets)) return sendJson(response, 401, { error: "invalid_signature" });
        const value = jsonBody(raw);
        if (!validMetaPayload(value)) return sendJson(response, 400, { error: "invalid_meta_payload" });
        // The synchronous FULL transaction commit completes before a 200 is issued.
        // A disk/SQLite error reaches catch and returns 503, so Meta may retry.
        const result = insert.run(digest(raw).toString("hex"), raw, signature, new Date().toISOString());
        return sendJson(response, 200, { ok: true, duplicate: result.changes === 0 });
      }
      if (url.pathname === "/sync/events" || url.pathname === "/sync/ack") {
        if (!isAuthorized(request)) return sendJson(response, 401, { error: "unauthorized" });
        if (url.pathname === "/sync/events" && request.method === "GET") {
          const supplied = url.searchParams.get("limit") ?? "25";
          if (!/^[0-9]{1,3}$/.test(supplied) || Number(supplied) < 1 || Number(supplied) > 100) return sendJson(response, 400, { error: "invalid_limit" });
          const suppliedCursor = url.searchParams.get("afterId") ?? "0";
          if (!/^[0-9]+$/.test(suppliedCursor) || !Number.isSafeInteger(Number(suppliedCursor))) return sendJson(response, 400, { error: "invalid_after_id" });
          const afterId = Number(suppliedCursor);
          const events = [];
          let byteCount = 0;
          for (const row of pending.iterate(afterId, Number(supplied))) {
            if (events.length && byteCount + row.raw_body.length > MAX_BATCH_BYTES) break;
            byteCount += row.raw_body.length;
            events.push({ id: row.id, bodyBase64: Buffer.from(row.raw_body).toString("base64"), signature: row.signature, sha256: row.sha256, receivedAt: row.received_at });
          }
          const lastId = events.at(-1)?.id ?? afterId;
          return sendJson(response, 200, { events, hasMore: Boolean(laterPending.get(lastId)) });
        }
        if (url.pathname === "/sync/ack" && request.method === "POST") {
          const body = jsonBody(await readBody(request, MAX_ACK_BYTES));
          if (!body || Array.isArray(body) || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100
            || body.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) return sendJson(response, 400, { error: "invalid_ids" });
          const ids = [...new Set(body.ids)];
          const ackedIds = [];
          const alreadyAckedIds = [];
          sqlite.exec("BEGIN IMMEDIATE");
          try {
            const rows = ids.map(id => byId.get(id));
            if (rows.some(row => !row)) {
              sqlite.exec("ROLLBACK");
              return sendJson(response, 409, { error: "unknown_event_id" });
            }
            const now = new Date().toISOString();
            for (const row of rows) {
              if (row.acked_at) alreadyAckedIds.push(row.id);
              else { ack.run(now, row.id); ackedIds.push(row.id); }
            }
            sqlite.exec("COMMIT");
          } catch (error) {
            sqlite.exec("ROLLBACK");
            throw error;
          }
          return sendJson(response, 200, { ok: true, ackedIds, alreadyAckedIds });
        }
        response.setHeader("allow", url.pathname === "/sync/events" ? "GET" : "POST");
        return sendJson(response, 405, { error: "method_not_allowed" });
      }
      if (["/webhook", "/healthz"].includes(url.pathname)) {
        response.setHeader("allow", url.pathname === "/webhook" ? "GET, POST" : "GET");
        return sendJson(response, 405, { error: "method_not_allowed" });
      }
      return sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      // No URL, headers, exception details or event body enter logs.
      const status = error?.status === 413 || error?.status === 400 ? error.status : 503;
      try { logger({ event: "request_failed", status }); } catch { /* logging cannot alter delivery */ }
      if (!response.headersSent && !response.destroyed) sendJson(response, status, { error: status === 413 ? "payload_too_large" : status === 400 ? "invalid_json" : "temporarily_unavailable" });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return {
    server,
    async listen(port = 8790) {
      if (closed) throw new Error("receiver_closed");
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
      });
      return server.address();
    },
    async close() {
      if (closed) return;
      closed = true;
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      sqlite.close();
    },
  };
}

export function configFromEnv(env = process.env) {
  return {
    dbPath: env.RECEIVER_DB_PATH,
    verifyToken: env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN,
    appSecrets: [env.INSTAGRAM_APP_SECRET, env.INSTAGRAM_PRODUCT_APP_SECRET],
    syncToken: env.RECEIVER_SYNC_TOKEN,
  };
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    // ESM resolves imports to the release path, while argv may still contain current/.
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  process.umask(0o077);
  let receiver;
  try {
    receiver = createReceiver({ ...configFromEnv(), logger: info => console.error(JSON.stringify(info)) });
    await receiver.listen(8790);
    console.info("receiver_ready address=127.0.0.1 port=8790");
  } catch {
    console.error("receiver_start_failed");
    process.exitCode = 1;
  }
  if (receiver && !process.exitCode) {
    const stop = async () => {
      try { await receiver.close(); process.exitCode = 0; }
      catch { console.error("receiver_stop_failed"); process.exitCode = 1; }
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
