// Server-only capability tokens scope call polling to the browser session that created the call.
// Tokens are HMAC-signed, expire quickly, and never contain call data.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 2 * 60 * 60;
const holder = globalThis as unknown as { __pharmabridgeAccessSecret?: string };

function signingSecret(): string {
  const configured =
    process.env.PHARMABRIDGE_ACCESS_TOKEN_SECRET?.trim() ??
    process.env.PHARMABRIDGE_SIMULATION_TOKEN_SECRET?.trim() ??
    process.env.CALLE_API_KEY?.trim();
  if (configured) return configured;
  holder.__pharmabridgeAccessSecret ??= randomBytes(32).toString("base64url");
  return holder.__pharmabridgeAccessSecret;
}

export function accessSecretConfigured(): boolean {
  return Boolean(process.env.PHARMABRIDGE_ACCESS_TOKEN_SECRET?.trim());
}

function signature(callId: string, expiresAt: number, nonce: string): string {
  return createHmac("sha256", signingSecret()).update(`${callId}:${expiresAt}:${nonce}`).digest("base64url");
}

export function issueCallAccessToken(callId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const nonce = randomBytes(18).toString("base64url");
  return `${expiresAt}.${nonce}.${signature(callId, expiresAt, nonce)}`;
}

export function validCallAccessToken(callId: string, token: string | null): boolean {
  if (!token || token.length > 300) return false;
  const [expiresRaw, nonce, supplied] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!nonce || !supplied || !Number.isSafeInteger(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signature(callId, expiresAt, nonce));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
