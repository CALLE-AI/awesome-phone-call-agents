export const DISPOSITIONS = [
  'confirmed',
  'review_required',
  'result_invalid',
  'failed',
  'canceled',
  'outcome_unknown',
  'needs_human',
];

const KNOWN_EVENT_TYPES = new Set([
  'call.completed',
  'call.failed',
  'call.result_validation_failed',
]);

const KNOWN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'failed', 'canceled']);
const NON_TERMINAL_STATUSES = new Set(['queued', 'in_progress']);

const result = (disposition, reason) => ({
  disposition,
  reason,
  is_actionable: disposition === 'confirmed',
});

export function deriveDisposition(event) {
  if (!event || typeof event !== 'object') {
    return result('needs_human', 'Webhook event was missing or not an object.');
  }
  if (!KNOWN_EVENT_TYPES.has(event.type)) {
    return result('needs_human', `Unrecognized webhook event type: ${String(event.type)}.`);
  }

  const data = event.data;
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') {
    return result('needs_human', 'Webhook event data was missing a status field.');
  }
  if (!KNOWN_STATUSES.has(data.status)) {
    return result('needs_human', `Unrecognized call status: ${data.status}.`);
  }

  if (event.type === 'call.result_validation_failed') {
    return result('result_invalid', 'CALL-E could not validate the structured result.');
  }
  if (data.status === 'failed' || event.type === 'call.failed') {
    const code = data.failure_code ? String(data.failure_code) : 'unspecified';
    return result('failed', `Call failed with failure_code: ${code}.`);
  }
  if (data.status === 'canceled') {
    return result('canceled', 'Call was canceled before completion.');
  }
  if (NON_TERMINAL_STATUSES.has(data.status)) {
    return result('outcome_unknown', `Call is still ${data.status}; no terminal outcome yet.`);
  }

  if (data.task_completed !== true) {
    return result('review_required', 'Call completed but task_completed was not true.');
  }
  const label = data.completion_confidence && data.completion_confidence.label;
  if (label !== 'high') {
    return result('review_required', `Completion confidence was ${String(label)}, not high.`);
  }
  if (data.structured_result === null || data.structured_result === undefined) {
    return result('review_required', 'Call completed but no structured result was extracted.');
  }

  return result('confirmed', 'Call completed with a high-confidence validated result.');
}
