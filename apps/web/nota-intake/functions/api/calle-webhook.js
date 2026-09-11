// POST /api/calle-webhook?s=<secret>  — terminal call result from CALL-E
// Authentication: the secret is baked into the webhook_url given to CALL-E at call creation and
// must match WEBHOOK_SECRET (constant-time). Fails closed when the secret is not configured.
// The body is never trusted for state: it only names the call, and the record is then re-fetched
// from CALL-E with the API key. Only the call id and arrival time are kept, not the raw payload.
import { json, safeEqual } from "../_lib.js";
import { syncIntake, callIdFromWebhook } from "../_calle.js";

export async function onRequestPost({ request, env }) {
  if (!env.WEBHOOK_SECRET) return json({ error: "webhook_not_configured" }, 503);
  const url = new URL(request.url);
  const presented = request.headers.get("x-webhook-secret") || url.searchParams.get("s");
  if (!safeEqual(presented, env.WEBHOOK_SECRET)) return json({ error: "forbidden" }, 403);

  const payload = await request.json().catch(() => ({}));
  const callId = String(callIdFromWebhook(payload) || "").slice(0, 128);
  if (!callId) return json({ ok: true, ignored: "no call id" });
  const intakeId = await env.INTAKES.get("bycall:" + callId);
  if (!intakeId) return json({ ok: true, ignored: "unknown call" });

  await env.INTAKES.put("webhook:" + callId,
    JSON.stringify({ call_id: callId, received_at: new Date().toISOString(), event: payload?.event || payload?.type || null }),
    { expirationTtl: 86400 * 7 });
  const rec = await syncIntake(env, intakeId);
  return json({ ok: true, status: rec?.status });
}
