import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OPS_SESSION_COOKIE = "ops_run_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LIVE_GRANT_TTL_MS = 10 * 60 * 1000;

export function opsRunSecret(): string {
  return process.env.OPS_RUN_SECRET?.trim() ?? "";
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function signOpsSession(now = Date.now()): { token: string; exp: number } {
  const secret = opsRunSecret();
  if (!secret) throw new Error("OPS_RUN_SECRET is not configured");
  const exp = now + SESSION_TTL_MS;
  const nonce = randomBytes(16).toString("hex");
  const token = `${exp}.${nonce}.${hmacHex(secret, `session|${exp}|${nonce}`)}`;
  return { token, exp };
}

export function verifyOpsSession(token: string | undefined, now = Date.now()): boolean {
  const secret = opsRunSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expRaw, nonce, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || now > exp) return false;
  if (!/^[0-9a-f]{32}$/.test(nonce)) return false;
  return safeEqual(sig, hmacHex(secret, `session|${exp}|${nonce}`));
}

export function signLiveGrant(
  caseId: string,
  phoneE164: string,
  now = Date.now()
): { token: string; exp: number } {
  const secret = opsRunSecret();
  if (!secret) throw new Error("OPS_RUN_SECRET is not configured");
  if (!caseId || !phoneE164.startsWith("+")) {
    throw new Error("live grant requires caseId and approved E.164");
  }
  const exp = now + LIVE_GRANT_TTL_MS;
  const nonce = randomBytes(16).toString("hex");
  const sig = hmacHex(secret, `live|${caseId}|${phoneE164}|${exp}|${nonce}`);
  return { token: `${caseId}.${exp}.${nonce}.${sig}`, exp };
}

export function verifyLiveGrant(
  token: string | undefined,
  caseId: string,
  phoneE164: string,
  now = Date.now()
): boolean {
  const secret = opsRunSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [id, expRaw, nonce, sig] = parts;
  if (id !== caseId) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || now > exp) return false;
  if (!/^[0-9a-f]{32}$/.test(nonce)) return false;
  return safeEqual(sig, hmacHex(secret, `live|${caseId}|${phoneE164}|${exp}|${nonce}`));
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return undefined;
}

export type OpsAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function authorizeOpsRequest(req: Request): OpsAuthResult {
  const secret = opsRunSecret();
  if (!secret) {
    return { ok: false, status: 503, error: "operator auth not configured" };
  }

  const bearer = req.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const token = bearer.slice(7).trim();
    if (safeEqual(token, secret) || verifyOpsSession(token)) return { ok: true };
  }

  const headerSecret = req.headers.get("x-ops-run-secret");
  if (headerSecret && safeEqual(headerSecret, secret)) return { ok: true };

  const session = cookieValue(req.headers.get("cookie"), OPS_SESSION_COOKIE);
  if (verifyOpsSession(session)) return { ok: true };

  return { ok: false, status: 401, error: "unauthorized" };
}

export function sessionCookieHeader(token: string, exp: number): string {
  const maxAge = Math.max(1, Math.floor((exp - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${OPS_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
