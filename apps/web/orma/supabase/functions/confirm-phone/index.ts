import { depsFromEnv, dispatchPhoneConfirmation } from "../_shared/calle.ts";

type Profile = { id: string; phone_e164: string | null; phone_confirmed_at: string | null };
type Consent = { id: string };
type Confirmation = { id: string; state: string; expires_at: string; calle_call_id: string | null };

function headers(key: string, authorization?: string): HeadersInit {
  return { apikey: key, authorization: authorization ?? `Bearer ${key}`, "content-type": "application/json" };
}
function url(base: string, path: string, query = ""): string {
  return `${base.replace(/\/+$/, "")}/rest/v1/${path}${query ? `?${query}` : ""}`;
}
// The web app calls this from the browser, so every response carries CORS headers.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://orma.nryn.dev",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};
function publicResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}
function code(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}
async function saltedHash(value: string): Promise<string> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, "0")).join("");
  const input = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return `${salt}:${Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("")}`;
}
async function one<T>(fetchImpl: typeof fetch, apiUrl: string, key: string, table: string, query: URLSearchParams): Promise<T | null> {
  const response = await fetchImpl(url(apiUrl, table, query.toString()), { headers: headers(key) });
  if (!response.ok) throw new Error(`${table} read failed`);
  return (await response.json() as T[])[0] ?? null;
}

export function createConfirmPhoneHandler(deps = depsFromEnv()): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...CORS_HEADERS, allow: "POST, OPTIONS" } });
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return publicResponse({ error: "authentication required" }, 401);
    const identity = await deps.fetch(`${deps.apiUrl.replace(/\/+$/, "")}/auth/v1/user`, { headers: headers(deps.serviceRoleKey, authorization) });
    if (!identity.ok) return publicResponse({ error: "authentication required" }, 401);
    const user = await identity.json() as { id?: string };
    if (!user.id) return publicResponse({ error: "authentication required" }, 401);
    const profile = await one<Profile>(deps.fetch, deps.apiUrl, deps.serviceRoleKey, "profiles", new URLSearchParams({ select: "id,phone_e164,phone_confirmed_at", id: `eq.${user.id}` }));
    if (!profile?.phone_e164) return publicResponse({ error: "profile has no E.164 number" }, 422);
    if (profile.phone_confirmed_at) return publicResponse({ error: "number is already confirmed" }, 409);
    const consent = await one<Consent>(deps.fetch, deps.apiUrl, deps.serviceRoleKey, "consents", new URLSearchParams({ select: "id", user_id: `eq.${user.id}`, kind: "eq.outbound_calls", revoked_at: "is.null", limit: "1" }));
    if (!consent) return publicResponse({ error: "profile has no live outbound_calls consent" }, 422);
    const recent = await deps.fetch(url(deps.apiUrl, "phone_confirmations", new URLSearchParams({ select: "id,state,expires_at,calle_call_id", user_id: `eq.${user.id}`, created_at: `gte.${new Date(Date.now() - 10 * 60_000).toISOString()}`, order: "created_at.desc", limit: "1" }).toString()), { headers: headers(deps.serviceRoleKey) });
    if (!recent.ok) throw new Error("confirmation limit read failed");
    const existing = (await recent.json() as Confirmation[])[0];
    if (existing) return publicResponse({ id: existing.id, state: existing.state, expires_at: existing.expires_at });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const day = today.toISOString();
    for (const [field, value, max] of [["user_id", user.id, 3], ["phone_e164", profile.phone_e164, 5]] as const) {
      const count = await deps.fetch(url(deps.apiUrl, "phone_confirmations", new URLSearchParams({ select: "id", [field]: `eq.${value}`, created_at: `gte.${day}` }).toString()), { headers: { ...headers(deps.serviceRoleKey), prefer: "count=exact", range: "0-0" } });
      if (!count.ok) throw new Error("confirmation limit read failed");
      if (Number(count.headers.get("content-range")?.split("/")[1] ?? "0") >= max) return publicResponse({ error: "confirmation attempt limit reached" }, 429);
    }
    const rawCode = code();
    const now = new Date();
    const confirmationId = crypto.randomUUID();
    const row = { id: confirmationId, user_id: user.id, phone_e164: profile.phone_e164, code_hash: await saltedHash(rawCode), idempotency_key: `orma:confirm:${confirmationId}`, expires_at: new Date(now.getTime() + 10 * 60_000).toISOString() };
    const inserted = await deps.fetch(url(deps.apiUrl, "phone_confirmations"), { method: "POST", headers: { ...headers(deps.serviceRoleKey), prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!inserted.ok) throw new Error("confirmation insert failed");
    const confirmation = (await inserted.json() as Confirmation[])[0];
    try {
      const dispatched = await dispatchPhoneConfirmation(confirmation.id, profile.phone_e164, rawCode, deps);
      const patch = {
        state: "dialled",
        calle_call_id: dispatched.callId,
        ...(dispatched.mode === "dry_run" ? { dry_run_request: JSON.parse(dispatched.requestBody) } : {}),
      };
      const patched = await deps.fetch(url(deps.apiUrl, "phone_confirmations", new URLSearchParams({ id: `eq.${confirmation.id}` }).toString()), { method: "PATCH", headers: headers(deps.serviceRoleKey), body: JSON.stringify(patch) });
      if (!patched.ok) throw new Error("confirmation dispatch record failed");
      const body: Record<string, unknown> = { id: confirmation.id, state: "dialled", expires_at: row.expires_at };
      // Only a dry run outside production returns the code. A live call is the proof.
      if (dispatched.mode === "dry_run" && deps.getEnv?.("ORMA_ENV") !== "production") body.code = rawCode;
      return publicResponse(body);
    } catch (error) {
      // The message never carries the code or an unmasked number.
      console.error("confirm-phone dispatch failed", error instanceof Error ? error.message : "unknown error");
      await deps.fetch(url(deps.apiUrl, "phone_confirmations", new URLSearchParams({ id: `eq.${confirmation.id}` }).toString()), { method: "PATCH", headers: headers(deps.serviceRoleKey), body: JSON.stringify({ state: "failed" }) });
      return publicResponse({ id: confirmation.id, state: "failed", expires_at: row.expires_at, error: "The confirmation call could not be placed. Try again in a few minutes." }, 502);
    }
  };
}
if (import.meta.main) {
  const handler = createConfirmPhoneHandler();
  // An unexpected error still answers with CORS headers, so the browser shows the error.
  Deno.serve(async (request) => {
    try {
      return await handler(request);
    } catch {
      return publicResponse({ error: "confirmation request failed" }, 500);
    }
  });
}
