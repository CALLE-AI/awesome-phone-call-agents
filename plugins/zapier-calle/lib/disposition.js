// 'outside_calling_window' and 'suppressed' are produced by the create
// action before dialing (see lib/calling-window.js and lib/suppression.js
// respectively), never by this webhook classifier. They are listed here
// only so DISPOSITIONS stays the single source of truth for every value a
// Zap can see; deriveDisposition below must never return either of them.
export const DISPOSITIONS = Object.freeze([
  'confirmed',
  'review_required',
  'result_invalid',
  'failed',
  'canceled',
  'outcome_unknown',
  'needs_human',
  'outside_calling_window',
  'suppressed',
]);

const KNOWN_EVENT_TYPES = new Set([
  'call.completed',
  'call.failed',
  'call.result_validation_failed',
]);

const KNOWN_STATUSES = new Set(['queued', 'in_progress', 'completed', 'failed', 'canceled']);
const NON_TERMINAL_STATUSES = new Set(['queued', 'in_progress']);

const MAX_ECHOED_LENGTH = 200;

const result = (disposition, reason) => ({
  disposition,
  reason,
  is_actionable: disposition === 'confirmed',
});

function truncate(value) {
  const text = String(value);
  return text.length > MAX_ECHOED_LENGTH ? `${text.slice(0, MAX_ECHOED_LENGTH)}...` : text;
}

// Distinguishes "no structured result at all" from "a structured result that
// carries no data" so the reason string can say which one happened.
function structuredResultState(data) {
  if (!Object.hasOwn(data, 'structured_result')) return 'missing';
  const value = data.structured_result;
  if (value === null || value === undefined) return 'missing';
  if (typeof value !== 'object' || Array.isArray(value)) return 'empty';
  return Object.keys(value).length > 0 ? 'ok' : 'empty';
}

function classify(event) {
  if (!event || typeof event !== 'object') {
    return result('needs_human', 'Webhook event was missing or not an object.');
  }
  if (!KNOWN_EVENT_TYPES.has(event.type)) {
    return result('needs_human', `Unrecognized webhook event type: ${truncate(event.type)}.`);
  }

  const data = event.data;
  if (
    !data ||
    typeof data !== 'object' ||
    !Object.hasOwn(data, 'status') ||
    typeof data.status !== 'string'
  ) {
    return result('needs_human', 'Webhook event data was missing a status field.');
  }
  if (!KNOWN_STATUSES.has(data.status)) {
    return result('needs_human', `Unrecognized call status: ${truncate(data.status)}.`);
  }

  if (event.type === 'call.result_validation_failed') {
    return result('result_invalid', 'CALL-E could not validate the structured result.');
  }
  if (data.status === 'failed' || event.type === 'call.failed') {
    const code = data.failure_code ? truncate(data.failure_code) : 'unspecified';
    return result('failed', `Call failed with failure_code: ${code}.`);
  }
  if (data.status === 'canceled') {
    return result('canceled', 'Call was canceled before completion.');
  }
  if (NON_TERMINAL_STATUSES.has(data.status)) {
    return result('outcome_unknown', `Call is still ${data.status}; no terminal outcome yet.`);
  }

  const taskCompleted = Object.hasOwn(data, 'task_completed') && data.task_completed === true;
  if (!taskCompleted) {
    return result('review_required', 'Call completed but task_completed was not true.');
  }
  const confidence = Object.hasOwn(data, 'completion_confidence')
    ? data.completion_confidence
    : undefined;
  const label = confidence && confidence.label;
  if (label !== 'high') {
    return result('review_required', `Completion confidence was ${truncate(label)}, not high.`);
  }

  const structuredResult = structuredResultState(data);
  if (structuredResult === 'missing') {
    return result('review_required', 'Call completed but no structured result was extracted.');
  }
  if (structuredResult === 'empty') {
    return result('review_required', 'Call completed but the structured result was empty.');
  }

  return result('confirmed', 'Call completed with a high-confidence validated result.');
}

// Fail-closed at the function boundary: a malformed or hostile event must
// classify as needs_human, never escape as an exception. Task 8 spreads this
// return value straight into a Zap output, so a throw here would abort the
// Zap instead of routing the call to human review.
export function deriveDisposition(event) {
  try {
    return classify(event);
  } catch {
    return result('needs_human', 'Could not classify the webhook event.');
  }
}
