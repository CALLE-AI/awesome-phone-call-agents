// Server-issued signatures prove a facility's phone number came from PharmaBridge's own discovery
// lookup (OpenStreetMap or Google Places). "Direct" routing only dials signed numbers, so a browser
// can never inject an arbitrary destination.
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 12 * 60 * 60;

interface Signable {
  id: string;
  kind: string;
  name: string;
  phone: string | null;
}

function secret(): string | null {
  return process.env.PHARMABRIDGE_ACCESS_TOKEN_SECRET?.trim() || null;
}

function mac(key: string, facility: Signable, expiresAt: number): string {
  return createHmac("sha256", key)
    .update(`${facility.kind}|${facility.id}|${facility.phone}|${facility.name}|${expiresAt}`)
    .digest("base64url");
}

export function signFacility(facility: Signable): string | null {
  const key = secret();
  if (!key || !facility.phone) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return `${expiresAt}.${mac(key, facility, expiresAt)}`;
}

export function verifyFacility(facility: Signable, signature: string | null | undefined): boolean {
  const key = secret();
  if (!key || !signature || !facility.phone || signature.length > 200) return false;
  const [expiresRaw, supplied] = signature.split(".");
  const expiresAt = Number(expiresRaw);
  if (!supplied || !Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(mac(key, facility, expiresAt));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
