// POST /api/calle-webhook?s=<secret>  — terminal call result from CALL-E
import { json } from "../_lib.js";
import { syncIntake, callIdFromWebhook } from "../_calle.js";

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ error: "forbidden" }, 403);
  }
  const payload = await request.json().catch(() => ({}));
  const callId = callIdFromWebhook(payload);
  if (!callId) return json({ ok: true, ignored: "no call id" });
  const intakeId = await env.INTAKES.get("bycall:" + callId);
  if (!intakeId) return json({ ok: true, ignored: "unknown call" });
  // Keep a copy of the raw payload for the demo/debugging, then re-fetch authoritative state.
  await env.INTAKES.put("webhook:" + callId, JSON.stringify(payload), { expirationTtl: 86400 * 7 });
  const rec = await syncIntake(env, intakeId);
  return json({ ok: true, status: rec?.status });
}
