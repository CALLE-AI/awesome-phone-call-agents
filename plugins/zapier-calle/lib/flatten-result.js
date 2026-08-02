import { deriveDisposition } from './disposition.js';
import { redactDeep } from './redact.js';

const transcriptText = (recipients) =>
  recipients
    .flatMap((recipient) => recipient.attempts || [])
    .flatMap((attempt) => attempt.transcript_turns || [])
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join('\n');

export function flattenResult(event) {
  const { disposition, reason, is_actionable } = deriveDisposition(event);
  const data = (event && event.data) || {};
  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  const confidence = data.completion_confidence || {};
  const structured = data.structured_result && typeof data.structured_result === 'object'
    ? data.structured_result
    : {};

  const flat = {
    disposition,
    disposition_reason: reason,
    is_actionable,
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
    structured_result: data.structured_result === undefined ? null : data.structured_result,
    recipients,
  };

  for (const [key, value] of Object.entries(structured)) {
    flat[`result_${key}`] = value;
  }

  return redactDeep(flat);
}
