import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const host = "127.0.0.1";
const port = Number(process.env.WEBHOOK_GATEWAY_PORT || 8788);
const upstreamOrigin = process.env.WEBHOOK_UPSTREAM_ORIGIN || "http://127.0.0.1:3000";
const webhookPath = "/api/instagram/webhook";
const maxBodyBytes = 2 * 1024 * 1024;

function loadVerificationToken() {
  const environment = readFileSync(new URL("../.env", import.meta.url), "utf8");
  const line = environment.split(/\r?\n/).find((entry) => entry.startsWith("INSTAGRAM_WEBHOOK_VERIFY_TOKEN="));
  return line?.slice(line.indexOf("=") + 1) || "";
}

const verificationToken = loadVerificationToken();

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("payload_too_large");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, response) => {
  try {
    const incomingUrl = new URL(request.url || "/", `http://${request.headers.host || host}`);

    if (incomingUrl.pathname !== webhookPath) {
      sendJson(response, 404, { error: "Rota não encontrada." });
      return;
    }

    if (request.method !== "GET" && request.method !== "POST") {
      response.setHeader("allow", "GET, POST");
      sendJson(response, 405, { error: "Método não permitido." });
      return;
    }

    if (request.method === "GET") {
      const mode = incomingUrl.searchParams.get("hub.mode") || "";
      const token = incomingUrl.searchParams.get("hub.verify_token") || "";
      const challenge = incomingUrl.searchParams.get("hub.challenge") || "";

      if (mode === "subscribe" && challenge && verificationToken && secretsMatch(token, verificationToken)) {
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(challenge);
        return;
      }

      sendJson(response, 403, { error: "Verificação do webhook recusada." });
      return;
    }

    const body = await readBody(request);
    const headers = new Headers();

    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || ["host", "connection", "content-length"].includes(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }

    headers.set("x-forwarded-proto", "https");
    headers.set("x-forwarded-host", request.headers.host || "");

    const upstream = new URL(webhookPath, upstreamOrigin);
    const upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });

    const responseHeaders = {};
    for (const [name, value] of upstreamResponse.headers) {
      if (["connection", "content-encoding", "transfer-encoding"].includes(name)) continue;
      responseHeaders[name] = value;
    }

    response.writeHead(upstreamResponse.status, responseHeaders);
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      sendJson(response, 413, { error: "Payload muito grande." });
      return;
    }

    sendJson(response, 502, { error: "Webhook local indisponível." });
  }
});

server.listen(port, host, () => {
  console.log(`Webhook gateway restrito em http://${host}:${port}${webhookPath}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
