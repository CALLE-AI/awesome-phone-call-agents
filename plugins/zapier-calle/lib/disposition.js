// The last three are produced by the create actions before dialing (see
// lib/calling-window.js, lib/suppression.js and lib/retry-policy.js), never
// by this webhook classifier. They are listed here only so DISPOSITIONS
// stays the single source of truth for every value a Zap can see;
// deriveDisposition below must never return any of them.
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
  'retry_policy_blocked',
]);

import {
  findUnusableFields,
  describeUnusableFields,
  checkConfidenceScore,
  DEFAULT_MIN_CONFIDENCE_SCORE,
} from './result-quality.js';
import { checkGrounding, describeUngrounded } from './grounding.js';
import { scalarMatches } from './result-schema.js';
import { normalizeSpeech } from './transcript.js';

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

function classify(event, options) {
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

  const scoreCheck = checkConfidenceScore(confidence, options.minConfidenceScore);
  if (!scoreCheck.ok) {
    return result('review_required', scoreCheck.reason);
  }

  const structuredResult = structuredResultState(data);
  if (structuredResult === 'missing') {
    return result('review_required', 'Call completed but no structured result was extracted.');
  }
  if (structuredResult === 'empty') {
    return result('review_required', 'Call completed but the structured result was empty.');
  }

  // A present result is not the same as a usable one. CALL-E reports high
  // confidence in its *judgment*, which includes being confident that the
  // caller never answered the question - so `{"qualified": "unknown"}` is a
  // high-confidence result carrying no answer.
  const unusable = findUnusableFields(data.structured_result, options.resultSchema);
  if (unusable.length > 0) {
    return result(
      'review_required',
      `Structured result is not actionable: ${truncate(describeUnusableFields(unusable))}.`,
    );
  }

  // Last gate, and the only one that reads the transcript rather than the
  // model's conclusions. Every check above asks whether the extraction says
  // something usable; this one asks whether the recipient ever said it. Runs
  // only when the caller's result_schema opted in by declaring `_quote`
  // fields - see lib/grounding.js. The schema is passed in as well as the
  // result, so a quote the schema demanded and the model omitted is caught;
  // otherwise the check would go quiet exactly when nothing was cited.
  const grounding = checkGrounding(data.structured_result, data.recipients, options.resultSchema);
  if (grounding.ungrounded.length > 0) {
    return result(
      'review_required',
      `Structured result is not supported by the transcript: ${truncate(describeUngrounded(grounding.ungrounded))}.`,
    );
  }

  return result('confirmed', 'Call completed with a high-confidence validated result.');
}

function classifyCall(event, options) {
  const data = event.data;
  if (!['call.completed', 'call.failed', 'call.canceled'].includes(event.type)) {
    return result('needs_human', `Unrecognized v2 event type: ${truncate(event.type)}.`);
  }
  if (!Object.hasOwn(data, 'status') || !KNOWN_STATUSES.has(data.status)) {
    return result('needs_human', 'Call has no recognized execution status.');
  }
  if (data.result_status === 'pending' || NON_TERMINAL_STATUSES.has(data.status)) {
    return result('outcome_unknown', 'Call result is still pending; retrieve the same API Call ID.');
  }
  if (!['available', 'unavailable', 'not_applicable'].includes(data.result_status)) {
    return result('needs_human', 'Call has no recognized result readiness state.');
  }
  if (data.status === 'failed' || event.type === 'call.failed' || data.error) {
    return result('failed', `Call error: ${truncate(data.error?.code || 'unspecified')}.`);
  }
  if (data.status === 'canceled' || event.type === 'call.canceled') {
    return result('canceled', 'Call was canceled.');
  }
  if (data.call_outcome !== 'completed') {
    return result('review_required', `Telephone outcome was ${truncate(data.call_outcome)}; no business confirmation.`);
  }
  const answers = data.result;
  if (data.result_status !== 'available' || !answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length === 0) {
    return result('review_required', 'No usable business result is available; do not redial automatically.');
  }
  if (Object.values(answers).some((value) => value === null || !['string', 'boolean', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))) {
    return result('review_required', 'Call result is not a flat scalar object.');
  }
  const schema = options.resultSchema;
  if (schema?.properties) {
    const invalid = Object.entries(answers).find(([key, value]) => {
      const rule = schema.properties[key];
      return !rule || !scalarMatches(rule.type, value) || (Array.isArray(rule.enum) && !rule.enum.includes(value));
    });
    if (invalid) return result('review_required', `Result field ${truncate(invalid[0])} does not match its schema.`);
  }
  const unusable = findUnusableFields(answers, schema);
  if (unusable.length) return result('review_required', `Result is not actionable: ${truncate(describeUnusableFields(unusable))}.`);
  if (!Object.hasOwn(answers, 'business_confirmed') || answers.business_confirmed !== true) {
    return result('review_required', 'result.business_confirmed must explicitly be true before automatic confirmation.');
  }
  if (typeof answers.business_confirmed_quote !== 'string' || !answers.business_confirmed_quote.trim()) {
    return result('review_required', 'Business confirmation requires a recipient quote.');
  }
  const grounding = checkGrounding(answers, data, schema);
  if (!grounding.enforced || grounding.ungrounded.length) {
    return result('review_required', `Business result is not supported by the transcript: ${truncate(describeUngrounded(grounding.ungrounded))}.`);
  }
  // shortcut: English denial cues only; review other languages or ambiguous wording manually.
  if (/\b(no|not|never|cannot|cant|dont|doesnt|didnt|isnt|arent|wasnt|werent|wont|wouldnt|couldnt|havent|hasnt|hadnt|unsure|uncertain)\b/.test(normalizeSpeech(answers.business_confirmed_quote))) {
    return result('review_required', 'The confirmation quote contains a denial or uncertainty; review it against the business answer.');
  }
  return result('confirmed', 'Business confirmation is explicit and its quote matches the recipient transcript.');
}

export function deriveDisposition(event, options = {}) {
  try {
    if (event?.data?.object === 'call') return classifyCall(event, options);
    if (event?.data?.object !== 'call_task') return result('needs_human', 'Unknown Call interface; use the interface that created this record.');
    return classify(event, {
      resultSchema: options.resultSchema,
      minConfidenceScore: options.minConfidenceScore === undefined ? DEFAULT_MIN_CONFIDENCE_SCORE : options.minConfidenceScore,
    });
  } catch {
    return result('needs_human', 'Could not classify the webhook event.');
  }
}
