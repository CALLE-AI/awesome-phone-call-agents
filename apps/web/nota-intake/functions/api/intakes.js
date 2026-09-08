// GET /api/intakes?token=…[&sync=1][&id=intake_…]   — staff console data (newest first)
//   sync=1  re-fetch any in-flight intake or reminder calls from CALL-E
//   id=…    return just that record (used for live polling after "Call a client")
import { json } from "../_lib.js";
import { syncIntake } from "../_calle.js";

function authed(request, env) {
  const t = new URL(request.url).searchParams.get("token") || request.headers.get("x-review-token");
  return env.REVIEW_TOKEN && t === env.REVIEW_TOKEN;
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "forbidden" }, 403);
  const url = new URL(request.url);
  const sync = url.searchParams.get("sync") === "1";
  const one = url.searchParams.get("id");

  if (one) {
    let rec = sync ? await syncIntake(env, one) : JSON.parse((await env.INTAKES.get(one)) || "null");
    return rec ? json({ intakes: [rec] }) : json({ error: "not_found" }, 404);
  }

  const list = await env.INTAKES.list({ prefix: "intake_" });
  const out = [];
  for (const k of list.keys) {
    let rec = JSON.parse(await env.INTAKES.get(k.name));
    const pendingReminder = (rec.reminders || []).some(r => !["completed", "failed"].includes(r.calle_status));
    if (sync && (rec.status === "calling" || pendingReminder)) rec = await syncIntake(env, rec.id) || rec;
    out.push(rec);
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json({ intakes: out });
}
