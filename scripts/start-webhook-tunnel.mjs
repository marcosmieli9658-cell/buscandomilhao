import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const gatewayOrigin = process.env.WEBHOOK_GATEWAY_ORIGIN || "http://127.0.0.1:8788";
const webhookPath = "/api/instagram/webhook";

function readEnvironment() {
  const contents = readFileSync(new URL("../.env", import.meta.url), "utf8");
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const environment = readEnvironment();
const appId = environment.INSTAGRAM_APP_ID;
const appSecret = environment.INSTAGRAM_APP_SECRET;
const verifyToken = environment.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
const graphVersion = environment.INSTAGRAM_GRAPH_VERSION || "v26.0";

if (!appId || !appSecret || !verifyToken) {
  throw new Error("INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET e INSTAGRAM_WEBHOOK_VERIFY_TOKEN são obrigatórios para abrir o túnel.");
}

async function registerWebhook(tunnelOrigin) {
  const callbackUrl = `${tunnelOrigin}${webhookPath}`;
  const endpoint = new URL(`https://graph.facebook.com/${graphVersion}/${appId}/subscriptions`);
  const body = new URLSearchParams({
    object: "instagram",
    callback_url: callbackUrl,
    fields: "messages",
    verify_token: verifyToken,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${appId}|${appSecret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const result = await response.json();
  if (!response.ok) {
    const code = result?.error?.code ? `, código ${result.error.code}` : "";
    throw new Error(`A Meta recusou a atualização do webhook com status ${response.status}${code}.`);
  }
  if (!result.success) throw new Error("A Meta não confirmou a atualização do webhook.");

  console.log(`Webhook público registrado: ${callbackUrl}`);
}

async function waitForTunnel(tunnelOrigin) {
  const probe = `${tunnelOrigin}${webhookPath}?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=probe`;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(probe, { redirect: "manual" });
      if (response.status === 403) return;
    } catch {
      // The quick tunnel URL is announced before every edge connection is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("O túnel HTTPS não ficou acessível dentro do prazo esperado.");
}

function openTunnel() {
  return new Promise((resolve, reject) => {
    const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", gatewayOrigin], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let registrationStarted = false;
    let settled = false;
    let startupOutput = "";
    let tunnelOrigin;

    const fail = async (error) => {
      if (settled) return;
      settled = true;
      if (tunnel.exitCode === null) {
        const exited = new Promise((done) => tunnel.once("exit", done));
        tunnel.kill();
        await exited;
      }
      reject(error);
    };

    const handleOutput = (chunk) => {
      const message = chunk.toString();
      startupOutput = `${startupOutput}${message}`.slice(-16_000);
      const match = startupOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && !tunnelOrigin) {
        tunnelOrigin = match[0];
        console.log(`Túnel criado, aguardando disponibilidade: ${tunnelOrigin}`);
      }
      if (!tunnelOrigin || registrationStarted || !startupOutput.includes("Registered tunnel connection")) return;
      registrationStarted = true;
      waitForTunnel(tunnelOrigin)
        .then(() => registerWebhook(tunnelOrigin))
        .then(() => {
          if (settled) return;
          settled = true;
          resolve(tunnel);
        })
        .catch(fail);
    };

    tunnel.stdout.on("data", handleOutput);
    tunnel.stderr.on("data", handleOutput);
    tunnel.once("error", () => fail(new Error("Não foi possível iniciar o cloudflared. Confirme se ele está instalado.")));
    tunnel.once("exit", (code) => {
      if (!settled) fail(new Error(`O cloudflared encerrou antes do registro do webhook (${code ?? "sem código"}).`));
    });
  });
}

let activeTunnel;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    activeTunnel?.kill();
    process.exit(0);
  });
}

for (let attempt = 1; attempt <= 4 && !activeTunnel; attempt += 1) {
  try {
    activeTunnel = await openTunnel();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao registrar o webhook.";
    console.error(`${message} Tentativa ${attempt} de 4.`);
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

if (!activeTunnel) {
  process.exitCode = 1;
} else {
  await new Promise((resolve) => activeTunnel.once("exit", resolve));
  if (!stopping) {
    console.error("O túnel HTTPS foi encerrado inesperadamente.");
    process.exitCode = 1;
  }
}
