import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeEvent, readConfig, runSync, syncOnce } from "./sync-inbound.mjs";

const config = readConfig({ RECEIVER_ORIGIN: "https://receiver.example/api/buscando-milhao", RECEIVER_SYNC_TOKEN: "local-test-token-never-a-real-secret" });
function event(id = 1, extra = {}) {
  const bytes = Buffer.from(JSON.stringify({ object: "instagram", entry: [{ messaging: [{ timestamp: 1793188800000, sender: { id: "test-sender" }, message: { mid: `test-${id}`, text: "Olá, informação com acento." } }] }] }));
  return { id, bodyBase64: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex"), signature: `sha256=${"a".repeat(64)}`, receivedAt: "2026-10-28T12:00:00.000Z", ...extra };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
function network({ events = [event()], local = { ok: true, received: 1, duplicates: 0 }, ack, before } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    before?.(url, options);
    if (url.startsWith(config.eventsUrl)) return json({ events, hasMore: false });
    if (url === config.localUrl) return local instanceof Response ? local.clone() : json(local);
    if (url === config.ackUrl) {
      const id = JSON.parse(options.body).ids[0];
      return ack ? ack(id) : json({ ok: true, ackedIds: [id], alreadyAckedIds: [] });
    }
    throw new Error("Unexpected endpoint");
  };
  return { fetchImpl, calls };
}

test("configuration preserves the HTTPS receiver prefix and restricts local to loopback", () => {
  assert.equal(config.eventsUrl, "https://receiver.example/api/buscando-milhao/sync/events");
  assert.equal(config.localUrl, "http://127.0.0.1:3000/api/instagram/webhook");
  for (const origin of ["http://receiver.example", "https://a:b@receiver.example", "https://receiver.example/?token=secret", "https://receiver.example/#fragment"]) {
    assert.throws(() => readConfig({ RECEIVER_ORIGIN: origin, RECEIVER_SYNC_TOKEN: config.token }));
  }
  for (const origin of ["http://192.168.1.2:3000", "http://127.0.0.1.evil.test", "http://example.com", "http://user@127.0.0.1", "http://127.0.0.1/somewhere"]) {
    assert.throws(() => readConfig({ RECEIVER_ORIGIN: "https://example.com", RECEIVER_LOCAL_ORIGIN: origin, RECEIVER_SYNC_TOKEN: config.token }));
  }
  assert.throws(() => readConfig({ RECEIVER_ORIGIN: "https://example.com", RECEIVER_SYNC_TOKEN: "short" }));
});

test("forwards the exact signed bytes and acknowledges only after full local success", async () => {
  const item = event();
  const n = network({ events: [item] });
  assert.deepEqual(await syncOnce(config, n), { fetched: 1, acknowledged: 1, failed: 0, hasMore: false, nextAfterId: 1 });
  assert.equal(n.calls.length, 3);
  assert.equal(n.calls[0].options.headers.authorization, `Bearer ${config.token}`);
  assert.deepEqual(n.calls[1].options.body, Buffer.from(item.bodyBase64, "base64"));
  assert.equal(n.calls[1].options.headers["x-hub-signature-256"], item.signature);
  assert.equal(n.calls[1].options.headers.authorization, undefined);
  assert.equal(n.calls[2].options.body, '{"ids":[1]}');
  for (const call of n.calls) { assert.equal(call.options.redirect, "error"); assert.ok(call.options.signal instanceof AbortSignal); }
});

test("a replay confirmed as duplicate locally is safely acknowledged", async () => {
  const n = network({ local: { ok: true, received: 0, duplicates: 1 }, ack: (id) => json({ ok: true, ackedIds: [], alreadyAckedIds: [id] }) });
  assert.equal((await syncOnce(config, n)).acknowledged, 1);
});

for (const [name, local] of [
  ["partial processing", { ok: true, received: 0, duplicates: 0 }],
  ["explicit failed count", { ok: true, received: 1, duplicates: 0, failed: 1 }],
  ["negative success", { ok: false, received: 1, duplicates: 0 }],
  ["invalid counts", { ok: true, received: "1", duplicates: 0 }],
  ["authentication failure", json({ error: "invalid signature" }, 401)],
  ["temporary server failure", json({ ok: false, received: 0, duplicates: 0, failed: 1 }, 503)],
  ["HTML pretending success", new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })],
]) {
  test(`retains the remote event after ${name}`, async () => {
    const n = network({ local });
    const result = await syncOnce(config, n);
    assert.equal(result.acknowledged, 0);
    assert.equal(result.failed, 1);
    assert.equal(n.calls.some((call) => call.url === config.ackUrl), false);
  });
}

test("rejects non-canonical base64 and a mismatched hash without forwarding", async () => {
  assert.throws(() => decodeEvent(event(1, { bodyBase64: "aGVsbG8=\n" })));
  const n = network({ events: [event(1, { sha256: "0".repeat(64) })] });
  assert.equal((await syncOnce(config, n)).failed, 1);
  assert.equal(n.calls.length, 1);
});

test("failure in one event does not acknowledge it or prevent another valid event", async () => {
  const n = network({ events: [event(1, { sha256: "0".repeat(64) }), event(2)] });
  assert.deepEqual(await syncOnce(config, n), { fetched: 2, acknowledged: 1, failed: 1, hasMore: false, nextAfterId: 2 });
  assert.deepEqual(n.calls.filter((c) => c.url === config.ackUrl).map((c) => JSON.parse(c.options.body)), [{ ids: [2] }]);
});

test("acknowledgment failure retries at least once without trusting unknown IDs", async () => {
  const n = network({ ack: () => json({ ok: true, ackedIds: [999], alreadyAckedIds: [] }) });
  assert.equal((await syncOnce(config, n)).failed, 1);
  assert.equal((await syncOnce(config, n)).failed, 1);
  assert.equal(n.calls.filter((c) => c.url === config.localUrl).length, 2);
});

test("zero-message signed events can acknowledge a fully processed empty result", async () => {
  const bytes = Buffer.from('{"object":"instagram","entry":[]}');
  const item = event(1, { bodyBase64: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  const n = network({ events: [item], local: { ok: true, received: 0, duplicates: 0 } });
  assert.equal((await syncOnce(config, n)).acknowledged, 1);
});

test("an attachment is a required durable message, not an empty payload", async () => {
  const bytes = Buffer.from(JSON.stringify({ object: "instagram", entry: [{ messaging: [{ timestamp: Date.now(), sender: { id: "sender" }, message: { mid: "audio", attachments: [{ type: "audio", payload: { url: "https://never-download.example/voice" } }] } }] }] }));
  const item = event(1, { bodyBase64: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  assert.equal(decodeEvent(item).expected, 1);
  const incomplete = network({ events: [item], local: { ok: true, received: 0, duplicates: 0 } });
  assert.equal((await syncOnce(config, incomplete)).acknowledged, 0);
  assert.equal(incomplete.calls.some((c) => c.url === config.ackUrl), false);
  const persisted = network({ events: [item], local: { ok: true, received: 1, duplicates: 0 } });
  assert.equal((await syncOnce(config, persisted)).acknowledged, 1);
});

function poisonQueue() {
  const pending = Array.from({ length: 26 }, (_, index) => event(index + 1));
  const cursors = [];
  const acknowledged = [];
  return {
    pending, cursors, acknowledged,
    fetchImpl: async (url, options) => {
      if (url.startsWith(config.eventsUrl)) {
        const cursor = Number(new URL(url).searchParams.get("afterId") || 0); cursors.push(cursor);
        const remaining = pending.filter((item) => item.id > cursor);
        return json({ events: remaining.slice(0, 25), hasMore: remaining.length > 25 });
      }
      if (url === config.localUrl) {
        const id = Number(JSON.parse(options.body.toString("utf8")).entry[0].messaging[0].message.mid.slice(5));
        return id <= 25 ? json({ ok: false, received: 0, duplicates: 0, failed: 1 }, 503)
          : json({ ok: true, received: 1, duplicates: 0 });
      }
      if (url === config.ackUrl) {
        const id = JSON.parse(options.body).ids[0]; acknowledged.push(id);
        pending.splice(pending.findIndex((item) => item.id === id), 1);
        return json({ ok: true, ackedIds: [id], alreadyAckedIds: [] });
      }
      throw new Error("unexpected endpoint");
    },
  };
}

test("25 poison events cannot starve the 26th valid event in a bounded sweep", async () => {
  const queue = poisonQueue();
  assert.equal(await runSync(config, { once: true, fetchImpl: queue.fetchImpl }), 1);
  assert.deepEqual(queue.cursors, [0, 25]);
  assert.deepEqual(queue.acknowledged, [26]);
  assert.equal(queue.pending.length, 25);
});

test("daemon preserves its cursor across page budgets and revisits failed events only after the tail", async () => {
  const queue = poisonQueue();
  const controller = new AbortController();
  let waits = 0;
  assert.equal(await runSync({ ...config, pagesPerCycle: 1 }, {
    signal: controller.signal, fetchImpl: queue.fetchImpl,
    sleepImpl: async () => { waits += 1; if (waits === 3) controller.abort(); },
  }), 0);
  assert.deepEqual(queue.cursors, [0, 25, 0]);
  assert.deepEqual(queue.acknowledged, [26]);
  assert.equal(queue.pending.length, 25);
});

test("network failures use bounded backoff, stop cleanly, and never log secrets or body", async () => {
  const controller = new AbortController();
  const waits = [];
  const logs = [];
  const code = await runSync(config, {
    signal: controller.signal,
    fetchImpl: async () => { throw new Error(`failure ${config.token} ${event().bodyBase64}`); },
    log: (item) => logs.push(item),
    sleepImpl: async (ms) => { waits.push(ms); if (waits.length === 8) controller.abort(); },
  });
  assert.equal(code, 0);
  assert.deepEqual(waits, [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.ok(!JSON.stringify(logs).includes(config.token));
  assert.ok(!JSON.stringify(logs).includes(event().bodyBase64));
});

test("--once semantics finish after one batch and report failure without retrying", async () => {
  const n = network({ local: { ok: false } });
  assert.equal(await runSync(config, { ...n, once: true }), 1);
  assert.equal(n.calls.length, 2);
});

test("request timeout retains the event without acknowledgment", async () => {
  const n = network();
  const mocked = async (url, options) => {
    if (url !== config.localUrl) return n.fetchImpl(url, options);
    return new Promise((_resolve, reject) => {
      const keepAlive = setTimeout(() => reject(new Error("test timeout did not fire")), 500);
      options.signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
    });
  };
  assert.equal((await syncOnce({ ...config, timeoutMs: 100 }, { fetchImpl: mocked })).failed, 1);
  assert.equal(n.calls.some((c) => c.url === config.ackUrl), false);
});

test("real receiver contract retains a failed local delivery and removes it only after replay acknowledgment", async (t) => {
  const { createReceiver } = await import("../deploy/receiver/receiver.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blessia-sync-contract-"));
  const appSecret = "only-a-test-secret";
  const receiver = createReceiver({ dbPath: path.join(directory, "receiver.db"), verifyToken: "test-verify", appSecrets: [appSecret], syncToken: config.token });
  t.after(async () => {
    await receiver.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("blessia-sync-contract-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const address = await receiver.listen(0);
  const origin = `http://127.0.0.1:${address.port}`;
  const bytes = Buffer.from(event().bodyBase64, "base64");
  const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(bytes).digest("hex")}`;
  const stored = await fetch(`${origin}/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: bytes });
  assert.equal(stored.status, 200);
  await stored.arrayBuffer();
  let failLocal = true;
  const fetchImpl = async (url, options) => {
    if (url === config.localUrl) {
      assert.deepEqual(options.body, bytes);
      assert.equal(options.headers["x-hub-signature-256"], signature);
      return failLocal ? json({ ok: false, failed: 1 }, 503) : json({ ok: true, received: 1, duplicates: 0 });
    }
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://receiver.example");
    assert.ok(parsed.pathname.startsWith("/api/buscando-milhao/sync/"));
    return fetch(`${origin}${parsed.pathname.slice("/api/buscando-milhao".length)}${parsed.search}`, options);
  };
  assert.equal((await syncOnce(config, { fetchImpl })).failed, 1);
  failLocal = false;
  assert.equal((await syncOnce(config, { fetchImpl })).acknowledged, 1);
  assert.equal((await syncOnce(config, { fetchImpl })).fetched, 0);
});
