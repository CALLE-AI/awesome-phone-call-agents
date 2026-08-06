import { issueOperatorSession } from "./_lib/operator-auth";
import { envFromProcess, storeFor } from "./_lib/calls";

export const config = { runtime: "edge" };

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  let body: { operator_id?: string; access_code?: string };
  try { body = await request.json() as typeof body; } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers }); }
  if (!body.operator_id || !body.access_code) return new Response(JSON.stringify({ error: "missing_credentials" }), { status: 400, headers });
  const env = envFromProcess();
  const store = storeFor(env);
  if (!store) return new Response(JSON.stringify({ error: "durable_storage_not_configured" }), { status: 503, headers });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const sourceHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(forwarded)))].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const attempts = await store.increment(`carecall:login-limit:${body.operator_id}:${sourceHash}`, 60 * 60);
  if (attempts > 10) return new Response(JSON.stringify({ error: "login_rate_limited", message: "Too many sign-in attempts. Try again later." }), { status: 429, headers });
  const token = await issueOperatorSession(body.operator_id, body.access_code, env);
  if (!token) return new Response(JSON.stringify({ error: "invalid_operator_credentials", message: "Operator sign-in was not accepted or is not configured." }), { status: 401, headers });
  return new Response(JSON.stringify({ token, expires_in_seconds: 1800 }), { headers });
}
