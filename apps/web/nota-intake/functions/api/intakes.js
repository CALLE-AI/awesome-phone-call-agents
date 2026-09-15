// GET /api/intakes[?sync=1][&id=intake_…]   — staff console data (newest first)
//   Auth: x-review-token header (REVIEW_TOKEN), constant-time compare.
//   sync=1  re-fetch any in-flight intake or reminder calls from CALL-E
//   id=…    return just that record (used for live polling after "Call a client")
// Output is redacted: phone numbers masked to country code + last four, provider evidence dropped.
import { json, staffAuthed, redactRecord } from "../_lib.js";
import { syncIntake } from "../_calle.js";

export async function onRequestGet({ request, env }) {
  if (!staffAuthed(request, env)) return json({ error: "forbidden" }, 403);
  const url = new URL(request.url);
  const sync = url.searchParams.get("sync") === "1";
  const one = url.searchParams.get("id");

  if (one) {
    if (!/^intake_[\w-]{1,64}$/.test(one)) return json({ error: "not_found" }, 404);
    const rec = sync ? await syncIntake(env, one) : JSON.parse((await env.INTAKES.get(one)) || "null");
    return rec ? json({ intakes: [redactRecord(rec)] }) : json({ error: "not_found" }, 404);
  }

  const list = await env.INTAKES.list({ prefix: "intake_" });
  const out = [];
  for (const k of list.keys) {
    let rec = JSON.parse(await env.INTAKES.get(k.name));
    const pendingReminder = (rec.reminders || []).some(r => !["completed", "failed"].includes(r.calle_status));
    if (sync && (rec.status === "calling" || pendingReminder)) rec = await syncIntake(env, rec.id) || rec;
    out.push(redactRecord(rec));
  }
  out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return json({ intakes: out });
}
