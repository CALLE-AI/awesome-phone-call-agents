// POST /api/remind?token=…  {id, when}  — place a consultation reminder call now, in the client's language.
// `when` is the consultation date/time in words (the console formats the picker value); it is spoken on the call.
import { json } from "../_lib.js";
import { reminderTask, scriptLang, REMINDER_SCHEMA } from "../_intake.js";

export async function onRequestPost({ request, env }) {
  const t = new URL(request.url).searchParams.get("token") || request.headers.get("x-review-token");
  if (!env.REVIEW_TOKEN || t !== env.REVIEW_TOKEN) return json({ error: "forbidden" }, 403);
  const { id, when } = await request.json().catch(() => ({}));
  const raw = id && await env.INTAKES.get(id);
  if (!raw || !when) return json({ error: "not_found" }, 404);
  const rec = JSON.parse(raw);
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
