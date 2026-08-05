import { deriveDisposition } from './disposition.js';
import { redactDeep } from './redact.js';
import { detectOptOut, OPT_OUT_REASON } from './opt-out.js';
import { toLeadState } from './lead-state.js';
import { transcriptText, lastUserTurn } from './transcript.js';

// `options` carries what the caller knows that the payload does not: the
// result_schema the call was placed with, and the confidence floor the user
// configured. The Call Completed trigger has neither, and passes nothing.
export function flattenResult(event, options = {}) {
  const derived = deriveDisposition(event, options);
  const data = (event && event.data) || {};
  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  const confidence = data.completion_confidence || {};
  const structured = data.structured_result && typeof data.structured_result === 'object'
    ? data.structured_result
    : {};

  // A revocation of consent overrides the business outcome. The structured
  // result stays on the output - a human still needs to see what was said -
  // but nothing downstream may treat this call as actionable.
  const optOut = detectOptOut(recipients);
  const disposition = optOut.requested ? 'needs_human' : derived.disposition;
  const reason = optOut.requested ? OPT_OUT_REASON : derived.reason;
  const isActionable = optOut.requested ? false : derived.is_actionable;

  const reviewTurn = disposition === 'confirmed' ? null : lastUserTurn(recipients);

  const flat = {
    disposition,
    disposition_reason: reason,
    is_actionable: isActionable,
    lead_state: toLeadState(disposition, { optOutRequested: optOut.requested }),
    event_id: event && event.id,
    event_type: event && event.type,
    call_id: data.id,
    status: data.status,
    task_completed: data.task_completed === true,
    confidence_label: confidence.label === undefined ? null : confidence.label,
    confidence_score: confidence.score === undefined ? null : confidence.score,
    summary: data.summary === undefined ? null : data.summary,
    evidence: data.evidence || [],
    failure_code: data.failure_code === undefined ? null : data.failure_code,
    failure_message: data.failure_message === undefined ? null : data.failure_message,
    correlation_id: (data.metadata && data.metadata.correlation_id) || null,
    completed_at: data.completed_at === undefined ? null : data.completed_at,
    recipients_total: recipients.length,
    recipients_completed: recipients.filter((r) => r.status === 'completed').length,
    recipients_failed: recipients.filter((r) => r.status === 'failed').length,
    transcript_text: transcriptText(recipients),
    // The line a human should read first, and where in the call to find it.
    // CALL-E exposes no recording, so offset_seconds is the closest thing to
    // "jump to the moment" that the API makes possible.
    review_excerpt: reviewTurn ? reviewTurn.text : null,
    review_excerpt_offset_seconds:
      reviewTurn && typeof reviewTurn.offset_seconds === 'number'
        ? reviewTurn.offset_seconds
        : null,
    opt_out_requested: optOut.requested,
    opt_out_excerpt: optOut.excerpt,
    opt_out_offset_seconds: optOut.offsetSeconds,
    structured_result: data.structured_result === undefined ? null : data.structured_result,
    recipients,
  };

  for (const [key, value] of Object.entries(structured)) {
    flat[`result_${key}`] = value;
  }

  return redactDeep(flat);
}
