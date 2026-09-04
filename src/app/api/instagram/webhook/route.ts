import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { processInstagramWebhook } from "@/integrations/instagram/webhook";
import { verifyMetaSignature } from "@/integrations/instagram/signature";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const expected = getEnv().INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ error: "Verificação do webhook recusada." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const env = getEnv();
  const signature = request.headers.get("x-hub-signature-256");
  const signatureIsValid = [env.INSTAGRAM_PRODUCT_APP_SECRET, env.INSTAGRAM_APP_SECRET]
    .filter((secret): secret is string => Boolean(secret))
    .some((secret) => verifyMetaSignature(rawBody, signature, secret));
  if (!signatureIsValid) {
    console.warn("[instagram-webhook] Assinatura rejeitada.", {
      hasAppSecret: Boolean(env.INSTAGRAM_APP_SECRET),
      hasProductAppSecret: Boolean(env.INSTAGRAM_PRODUCT_APP_SECRET),
      hasSignature: Boolean(signature),
      bodyBytes: Buffer.byteLength(rawBody),
    });
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  const result = await processInstagramWebhook(rawBody);
  console.info("[instagram-webhook] Evento aceito.", result);
  return NextResponse.json({ ok: true, ...result });
}
