// Shared helpers for the Nota.Lawyer intake Pages Functions.
import { REGIONS } from "./_regions.js";
export { REGIONS };

export function regionFor(e164) {
  const digits = (e164 || "").replace(/[^\d]/g, "");
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (REGIONS[cc]) return { cc, ...REGIONS[cc] };
  }
  return null;
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

// ---- authorization & safety -------------------------------------------------

// Constant-time string compare so a token can't be guessed byte by byte from response timing.
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a || ""));
  const y = new TextEncoder().encode(String(b || ""));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Staff token: header only (never the query string, which lands in logs and referrers).
export function staffAuthed(request, env) {
  const t = request.headers.get("x-review-token");
  return Boolean(env.REVIEW_TOKEN) && safeEqual(t, env.REVIEW_TOKEN);
}

// Browser origin check for endpoints that spend money (place calls). The page that serves the
// form is the only approved origin unless ALLOWED_ORIGINS (comma-separated) widens it.
export function originAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return false;   // fetch() from a page always sends Origin on POST
  const self = new URL(request.url).origin;
  const allowed = new Set([self, ...(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)]);
  return allowed.has(origin);
}

// Recipient policy: strict E.164, no short codes / emergency numbers, and when
// ALLOWED_RECIPIENTS is set (comma-separated E.164 list) only those numbers may be dialed.
export function recipientAllowed(env, phone) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { ok: false, error: "bad_phone" };
  const digits = phone.slice(1);
  if (/^1(911|411|611|811|988)/.test(digits) || /^(911|112|999|000)/.test(digits)) return { ok: false, error: "bad_phone" };
  const list = (env.ALLOWED_RECIPIENTS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (list.length && !list.includes(phone)) return { ok: false, error: "recipient_not_allowed" };
  return { ok: true };
}

// Fixed-window KV counter. Returns true when the caller is still under `limit` for this window.
export async function underLimit(env, key, limit, windowSec) {
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${bucket}`;
  const n = parseInt((await env.INTAKES.get(k)) || "0", 10) + 1;
  await env.INTAKES.put(k, String(n), { expirationTtl: windowSec + 60 });
  return n <= limit;
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

// ---- output masking ----------------------------------------------------------

// +19175550100 -> +1*****0100  (country code + last four)
export function maskPhone(e164) {
  const s = String(e164 || "");
  if (s.length < 6) return "***";
  const reg = regionFor(s);
  const cc = reg ? "+" + reg.cc : s.slice(0, 2);
  return cc + "*".repeat(Math.max(3, s.length - cc.length - 4)) + s.slice(-4);
}

// What the staff console may see: masked phone, no raw provider payloads, no evidence blobs.
export function redactRecord(rec) {
  if (!rec) return rec;
  const { evidence, ...rest } = rec;
  return {
    ...rest,
    form: { ...rec.form, phone: maskPhone(rec.form?.phone) },
    reminders: (rec.reminders || []).map(({ result, summary, status, calle_status, when, created_at, failure }) =>
      ({ result, summary, status, calle_status, when, created_at, failure })),
  };
}
