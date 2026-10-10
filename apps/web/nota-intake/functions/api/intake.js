// POST /api/intake  — form submission -> CALL-E phone interview, planned for the chosen matter type
// Authorization: this endpoint places a real, billed phone call, so it is gated by
//   - browser Origin (only the page that serves the form, or ALLOWED_ORIGINS),
//   - the staff token when the request comes from the console (source: "staff"),
//   - an optional INTAKE_ACCESS_CODE the public form must present (lock the demo down),
//   - recipient policy (E.164, no emergency/short codes, optional ALLOWED_RECIPIENTS list),
//   - rate limits: per IP per hour and a global daily cap (MAX_CALLS_PER_DAY).
import { json, regionFor, originAllowed, staffAuthed, safeEqual, recipientAllowed, underLimit, clientIp, maskPhone } from "../_lib.js";
import { intakeTask, scriptLang, resultSchema } from "../_intake.js";
import { MATTER_IDS } from "../_matters.js";

export async function onRequestPost({ request, env }) {
  if (!originAllowed(request, env)) return json({ error: "forbidden_origin" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (body.source === "staff" && !staffAuthed(request, env)) return json({ error: "forbidden" }, 403);
  if (body.source !== "staff" && env.INTAKE_ACCESS_CODE && !safeEqual(body.access_code, env.INTAKE_ACCESS_CODE)) {
    return json({ error: "access_code_required" }, 403);
  }

  const name = (body.name || "").trim().slice(0, 120);
  const phone = (body.phone || "").replace(/[^\d+]/g, "");
  const lang = ["es", "id"].includes(body.lang) ? body.lang : "en";   // UI language, for the record
  const locale = (body.locale || "").trim();
  const matterType = MATTER_IDS.includes(body.matter_type) ? body.matter_type : "other";
  const matterHint = (body.matter || "").trim().slice(0, 500);
  const email = (body.email || "").trim().slice(0, 120);
  const source = body.source === "staff" ? "staff" : "web";   // staff console or the public form
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "bad_email" }, 400);
  if (!name || !/^\+\d{8,15}$/.test(phone) || body.consent !== true) {
    return json({ error: "missing_fields" }, 400);
  }
  // The name is spoken on the call ("is this …?") — require something a person would answer to.
  if (!/^\p{L}[\p{L}\s'.-]{1,}$/u.test(name)) return json({ error: "bad_name" }, 400);
  const policy = recipientAllowed(env, phone);
  if (!policy.ok) return json({ error: policy.error }, 400);
  const reg = regionFor(phone);
  if (!reg) return json({ error: "unsupported_country" }, 400);
  // Rate limits (staff console is already token-gated, so only the public form is metered per IP).
  if (source === "web" && !(await underLimit(env, "ip:" + clientIp(request), Number(env.MAX_CALLS_PER_IP_HOUR || 3), 3600))) {
    return json({ error: "rate_limited" }, 429);
  }
  if (!(await underLimit(env, "global", Number(env.MAX_CALLS_PER_DAY || 20), 86400))) {
    return json({ error: "daily_cap_reached" }, 429);
  }
  const chosen = reg.locales.find(([code]) => code === locale) || reg.locales[0];
  const interviewLang = scriptLang(chosen[0]);

  const id = "intake_" + crypto.randomUUID();
  const firm = env.FIRM_NAME || "the firm";
  // The webhook only accepts callbacks that present WEBHOOK_SECRET, so refuse to dial without one configured.
  if (!env.WEBHOOK_SECRET || !env.CALLE_API_KEY) return json({ error: "server_not_configured" }, 500);
  const webhook = new URL("/api/calle-webhook?s=" + encodeURIComponent(env.WEBHOOK_SECRET), request.url).toString();

  const res = await fetch(`${env.CALLE_BASE_URL || "https://api.heycall-e.com"}/v1/calls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CALLE_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": id,
    },
    body: JSON.stringify({
      task: intakeTask({ lang: interviewLang, firm, name, matterType, matterHint, email }),
      recipients: [{ phones: [phone], region: reg.region, locale: chosen[0] }],
      recipient_result_schema: resultSchema(matterType),
      webhook_url: webhook,
      metadata: { intake_id: id, form_lang: lang, matter_type: matterType },
    }),
  });
  const calle = await res.json().catch(() => ({}));
  if (!res.ok || calle.status === "failed") {
    const msg = calle?.error?.message || calle?.failure_message || `CALL-E error ${res.status}`;
    return json({ error: "calle_rejected", message: msg }, 502);
  }

  const record = {
    id, created_at: new Date().toISOString(), status: "calling",
    form: { name, phone, email, lang, matter_type: matterType, matter: matterHint, locale: chosen[0], region: reg.region, source },
    call_id: calle.id, calle_status: calle.status, result: null, transcript: null, summary: null,
    reminders: [],
  };
  await env.INTAKES.put(id, JSON.stringify(record));
  await env.INTAKES.put("bycall:" + calle.id, id);
  return json({ ok: true, id, call_id: calle.id, interview_language: chosen[1], matter_type: matterType });
}
