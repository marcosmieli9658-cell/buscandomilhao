import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createReceiver } from "./receiver.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const verifyToken = "test-verify-not-a-production-secret";
const appSecrets = ["principal-test-secret", "product-test-secret"];
const syncToken = "independent-sync-test-token-at-least-32-characters";
const authorization = { authorization: `Bearer ${syncToken}` };
const payload = (text = "Teste conexão") => Buffer.from(JSON.stringify({ object: "instagram", entry: [{ id: "test-page", messaging: [{ message: { mid: "test-mid", text } }] }] }));
const sign = (raw, secret = appSecrets[0]) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;

async function fixture(t) {
  const stateDir = fs.mkdtempSync(path.join(directory, ".test-state-"));
  const dbPath = path.join(stateDir, "receiver.sqlite");
  const logs = [];
  const config = { dbPath, verifyToken, appSecrets, syncToken, logger: value => logs.push(value) };
  let receiver = createReceiver(config);
  let address = await receiver.listen(0);
  let base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await receiver.close();
    const resolved = fs.realpathSync(stateDir);
    const allowedRoot = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), allowedRoot);
    assert.ok(path.basename(resolved).startsWith(".test-state-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return {
    dbPath, logs,
    async request(route, options) { return fetch(base + route, options); },
    async post(raw = payload(), signature = sign(raw)) {
      return fetch(base + "/webhook", { method: "POST", headers: { "x-hub-signature-256": signature }, body: raw });
    },
    async events(limit) {
      const response = await fetch(base + `/sync/events${limit === undefined ? "" : `?limit=${limit}`}`, { headers: authorization });
      assert.equal(response.status, 200);
      return response.json();
    },
    async ack(ids) {
      return fetch(base + "/sync/ack", { method: "POST", headers: { ...authorization, "content-type": "application/json" }, body: JSON.stringify({ ids }) });
    },
    async restart() {
      await receiver.close();
      receiver = createReceiver(config);
      address = await receiver.listen(0);
      base = `http://127.0.0.1:${address.port}`;
    },
    async oversizedChunked() {
      return new Promise((resolve, reject) => {
        const request = http.request(base + "/webhook", { method: "POST", headers: { "x-hub-signature-256": sign(payload()) } }, response => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        });
        request.on("error", reject);
        request.write(Buffer.alloc(1024 * 1024 + 1, "x"));
        request.end(Buffer.alloc(1024 * 1024, "x"));
      });
    },
  };
}

test("GET challenge requires the correct verification token; health contains no queue data", async t => {
  const f = await fixture(t);
  const route = "/webhook?hub.mode=subscribe&hub.challenge=12345&hub.verify_token=";
  const good = await f.request(route + encodeURIComponent(verifyToken));
  assert.equal(good.status, 200);
  assert.equal(await good.text(), "12345");
  assert.equal((await f.request(route + "wrong")).status, 403);
  assert.equal((await f.request("/webhook?hub.mode=subscribe")).status, 403);
  assert.deepEqual(await (await f.request("/healthz")).json(), { ok: true });
});

test("both app secrets authenticate exact raw bytes, invalid signatures do not enter the queue", async t => {
  const f = await fixture(t);
  for (const [i, secret] of appSecrets.entries()) {
    const raw = payload(`Ação, café e pontuação. ${i}`);
    assert.equal((await f.post(raw, sign(raw, secret))).status, 200);
  }
  const raw = payload("new");
  assert.equal((await f.post(raw, sign(payload("different")))).status, 401);
  assert.equal((await f.post(raw, "sha256=00")).status, 401);
  assert.equal((await f.request("/webhook", { method: "POST", body: raw })).status, 401);
  assert.equal((await f.events()).events.length, 2);
});

test("signed malformed JSON, non-UTF8 and invalid Meta envelopes are rejected", async t => {
  const f = await fixture(t);
  for (const raw of [Buffer.from("{"), Buffer.from([0xff]), Buffer.from("null"), Buffer.from("[]"), Buffer.from('{"object":"instagram"}'), Buffer.from('{"object":"other","entry":[]}')]) {
    assert.equal((await f.post(raw)).status, 400);
  }
  assert.equal((await f.events()).events.length, 0);
});

test("2MiB cap covers content-length and chunked requests without inserting events", async t => {
  const f = await fixture(t);
  const raw = Buffer.alloc(2 * 1024 * 1024 + 1, "x");
  assert.equal((await f.post(raw)).status, 413);
  assert.equal(await f.oversizedChunked(), 413);
  assert.equal((await f.events()).events.length, 0);
});

test("payload is committed before 200, survives restart and is returned byte-for-byte until ACK", async t => {
  const f = await fixture(t);
  const raw = Buffer.from('{ "object": "instagram", "entry": [{"message":"Ação!"}] }\n');
  assert.deepEqual(await (await f.post(raw)).json(), { ok: true, duplicate: false });
  const reader = new DatabaseSync(f.dbPath, { readOnly: true });
  assert.equal(reader.prepare("SELECT count(*) AS n FROM receiver_events").get().n, 1);
  reader.close();
  const before = await f.events();
  await f.restart();
  const after = await f.events();
  assert.deepEqual(after, before);
  assert.deepEqual(Buffer.from(after.events[0].bodyBase64, "base64"), raw);
  assert.equal(after.events[0].signature, sign(raw));
  assert.equal(after.events[0].sha256, crypto.createHash("sha256").update(raw).digest("hex"));
  assert.equal(after.hasMore, false);
});

test("durability failure returns non-200 and leaves the event pending at the sender", async t => {
  const f = await fixture(t);
  const writer = new DatabaseSync(f.dbPath);
  writer.exec("CREATE TRIGGER simulate_disk_failure BEFORE INSERT ON receiver_events BEGIN SELECT RAISE(ABORT, 'test_failure'); END");
  writer.close();
  const response = await f.post();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "temporarily_unavailable" });
  assert.equal((await f.events()).events.length, 0);
  assert.deepEqual(f.logs, [{ event: "request_failed", status: 503 }]);
});

test("sync endpoints reject missing, incorrect, query-only and verification credentials", async t => {
  const f = await fixture(t);
  await f.post();
  for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: `Bearer ${verifyToken}` }, { authorization: `Basic ${syncToken}` }]) {
    assert.equal((await f.request("/sync/events", { headers })).status, 401);
    assert.equal((await f.request("/sync/ack", { method: "POST", headers, body: '{"ids":[1]}' })).status, 401);
  }
  assert.equal((await f.request(`/sync/events?token=${syncToken}`)).status, 401);
  assert.equal((await f.events()).events.length, 1);
});

test("dedupe survives restart and ACK; ACK is idempotent without deleting retained evidence", async t => {
  const f = await fixture(t);
  const raw = payload();
  await f.post(raw);
  assert.deepEqual(await (await f.post(raw)).json(), { ok: true, duplicate: true });
  const { events } = await f.events();
  const id = events[0].id;
  assert.deepEqual(await (await f.ack([id, id])).json(), { ok: true, ackedIds: [id], alreadyAckedIds: [] });
  assert.deepEqual(await (await f.ack([id])).json(), { ok: true, ackedIds: [], alreadyAckedIds: [id] });
  await f.restart();
  assert.deepEqual(await (await f.post(raw)).json(), { ok: true, duplicate: true });
  assert.deepEqual(await f.events(), { events: [], hasMore: false });
  const reader = new DatabaseSync(f.dbPath, { readOnly: true });
  const row = reader.prepare("SELECT count(*) AS n, acked_at FROM receiver_events").get();
  assert.equal(row.n, 1);
  assert.ok(row.acked_at);
  reader.close();
});

test("unknown IDs reject the whole ACK; malformed IDs do not change queue", async t => {
  const f = await fixture(t);
  await f.post();
  const id = (await f.events()).events[0].id;
  assert.equal((await f.ack([id, 999])).status, 409);
  for (const ids of [[], ["1"], [-1], [1.5], [null], new Array(101).fill(id)]) assert.equal((await f.ack(ids)).status, 400);
  assert.equal((await f.events()).events.length, 1);
});

test("bounded batches preserve ID order and report remaining events", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) await f.post(payload(`message-${i}`));
  const batch = await f.events(2);
  assert.equal(batch.events.length, 2);
  assert.equal(batch.hasMore, true);
  assert.ok(batch.events[0].id < batch.events[1].id);
  await f.ack(batch.events.map(event => event.id));
  const last = await f.events(2);
  assert.equal(last.events.length, 1);
  assert.equal(last.hasMore, false);
  for (const limit of ["0", "101", "-1", "NaN", "1.5"]) assert.equal((await f.request(`/sync/events?limit=${limit}`, { headers: authorization })).status, 400);
});

test("batch bytes are bounded even when callers request 100 large events", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) assert.equal((await f.post(payload(`${i}${"x".repeat(1_900_000)}`))).status, 200);
  const batch = await f.events(100);
  assert.equal(batch.events.length, 4);
  assert.equal(batch.hasMore, true);
  assert.ok(batch.events.reduce((sum, event) => sum + Buffer.from(event.bodyBase64, "base64").length, 0) <= 8 * 1024 * 1024);
});

test("afterId reaches later events when earlier events remain unacknowledged", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) await f.post(payload(`cursor-${i}`));
  const first = await f.events(2);
  assert.equal(first.hasMore, true);
  const response = await f.request(`/sync/events?limit=2&afterId=${first.events.at(-1).id}`, { headers: authorization });
  assert.equal(response.status, 200);
  const second = await response.json();
  assert.equal(second.events.length, 1);
  assert.equal(second.hasMore, false);
  assert.ok(second.events[0].id > first.events.at(-1).id);
  assert.deepEqual(await f.events(2), first);
  const exhausted = await f.request(`/sync/events?afterId=${second.events[0].id}`, { headers: authorization });
  assert.deepEqual(await exhausted.json(), { events: [], hasMore: false });
  for (const cursor of ["-1", "NaN", "1.5", "9007199254740992", ""]) {
    assert.equal((await f.request(`/sync/events?afterId=${cursor}`, { headers: authorization })).status, 400);
  }
});

test("persistent path and an independent strong sync credential are mandatory", () => {
  const dbPath = path.join(directory, ".test-never-created", "receiver.sqlite");
  const base = { dbPath, verifyToken, appSecrets, syncToken };
  assert.throws(() => createReceiver({ ...base, dbPath: ":memory:" }), /persistent/);
  assert.throws(() => createReceiver({ ...base, syncToken: "short" }), /sync_token/);
  assert.throws(() => createReceiver({ ...base, verifyToken: syncToken }), /independent/);
  assert.throws(() => createReceiver({ ...base, appSecrets: [syncToken] }), /independent/);
  assert.throws(() => createReceiver({ ...base, appSecrets: [] }), /app_secret/);
  assert.equal(fs.existsSync(path.dirname(dbPath)), false);
});
