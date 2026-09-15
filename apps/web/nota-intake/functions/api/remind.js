// POST /api/remind  {id, when}  — place a consultation reminder call now, in the client's language.
// `when` is the consultation date/time in words (the console formats the picker value); it is spoken on the call.
// Auth: x-review-token header (REVIEW_TOKEN) + browser Origin check; the recipient is the number
// already on the intake record (never taken from the request), re-checked against recipient policy.
import { json, staffAuthed, originAllowed, recipientAllowed, underLimit } from "../_lib.js";
import { reminderTask, scriptLang, REMINDER_SCHEMA } from "../_intake.js";

export async function onRequestPost({ request, env }) {
  if (!originAllowed(request, env)) return json({ error: "forbidden_origin" }, 403);
  if (!staffAuthed(request, env)) return json({ error: "forbidden" }, 403);
  const { id, when } = await request.json().catch(() => ({}));
  if (typeof id !== "string" || !/^intake_[\w-]{1,64}$/.test(id)) return json({ error: "not_found" }, 404);
  const raw = await env.INTAKES.get(id);
  if (!raw || typeof when !== "string" || !when.trim() || when.length > 120) return json({ error: "not_found" }, 404);
  const rec = JSON.parse(raw);
  const policy = recipientAllowed(env, rec.form.phone);
  if (!policy.ok) return json({ error: policy.error }, 400);
  if (!(await underLimit(env, "global", Number(env.MAX_CALLS_PER_DAY || 20), 86400))) return json({ error: "daily_cap_reached" }, 429);
  if (!env.CALLE_API_KEY) return json({ error: "server_not_configured" }, 500);
  const lang = scriptLang(rec.form.locale);
  const name = rec.result?.full_name || rec.form.name;
  const key = `${id}_rem_${(rec.reminders || []).length + 1}`;

  const res = await fetch(`${env.CALLE_BASE_URL || "https://api.heycall-e.com"}/v1/calls`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CALLE_API_KEY}`, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({
      task: reminderTask({ lang, firm: env.FIRM_NAME || "the firm", name, when }),
      recipients: [{ phones: [rec.form.phone], region: rec.form.region, locale: rec.form.locale }],
      recipient_result_schema: REMINDER_SCHEMA,
      metadata: { intake_id: id, kind: "reminder", when },
    }),
  });
  const calle = await res.json().catch(() => ({}));
  if (!res.ok || calle.status === "failed") {
    return json({ error: "calle_rejected", message: calle?.error?.message || calle?.failure_message }, 502);
  }
  rec.reminders = rec.reminders || [];
  rec.reminders.push({ call_id: calle.id, when, created_at: new Date().toISOString(), calle_status: calle.status, status: "calling", result: null });
  await env.INTAKES.put(id, JSON.stringify(rec));
  return json({ ok: true, call_id: calle.id });
}
