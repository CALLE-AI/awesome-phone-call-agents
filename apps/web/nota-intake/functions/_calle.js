// Pull authoritative call state from CALL-E and fold it into the KV intake record.
async function getCall(env, callId) {
  const res = await fetch(`${env.CALLE_BASE_URL || "https://api.heycall-e.com"}/v1/calls/${callId}`, {
    headers: { authorization: `Bearer ${env.CALLE_API_KEY}` },
  });
  return res.ok ? res.json() : null;
}

function statusOf(call) {
  if (call.status === "completed") return call.task_completed ? "interviewed" : "incomplete";
  if (call.status === "failed") return "failed";
  return "calling";
}

export async function syncIntake(env, intakeId) {
  const raw = await env.INTAKES.get(intakeId);
  if (!raw) return null;
  const rec = JSON.parse(raw);
  let changed = false;

  if (rec.status === "calling" || !rec.synced_at) {
    const call = await getCall(env, rec.call_id);
    if (call) {
      const rcp = (call.recipients || [])[0] || {};
      const attempts = rcp.attempts || [];
      const last = attempts[attempts.length - 1] || {};
      rec.calle_status = call.status;
      rec.result = rcp.structured_result || call.structured_result || rec.result;
      rec.summary = rcp.summary || call.summary || rec.summary;
      rec.transcript = last.transcript_turns || rec.transcript;
      rec.confidence = call.completion_confidence || rec.confidence;
      rec.evidence = call.evidence || rec.evidence;
      rec.failure = call.failure_message || null;
      rec.status = statusOf(call);
      rec.synced_at = new Date().toISOString();
      changed = true;
    }
  }

  // Reminder calls: keep their outcome (confirmed / reschedule request) current too.
  for (const r of rec.reminders || []) {
    if (["completed", "failed"].includes(r.calle_status)) continue;
    const call = await getCall(env, r.call_id);
    if (!call) continue;
    const rcp = (call.recipients || [])[0] || {};
    r.calle_status = call.status;
    r.status = statusOf(call);
    r.result = rcp.structured_result || call.structured_result || r.result || null;
    r.summary = rcp.summary || call.summary || r.summary || null;
    r.failure = call.failure_message || null;
    changed = true;
  }

  if (changed) await env.INTAKES.put(intakeId, JSON.stringify(rec));
  return rec;
}

export function callIdFromWebhook(payload) {
  return payload?.call_id || payload?.id || payload?.data?.id || payload?.data?.call_id
      || payload?.call?.id || payload?.object?.id || null;
}
