import crypto from "node:crypto";

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const received = Buffer.from(signatureHeader.slice(7), "hex");
  const expected = Buffer.from(crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}
