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
  const appSecret = getEnv().INSTAGRAM_APP_SECRET;
  if (!appSecret || !verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  const result = await processInstagramWebhook(rawBody);
  return NextResponse.json({ ok: true, ...result });
}
