import { buildPayload, isDryRun } from '../lib/build-payload.js';
import { INPUT_FIELDS } from '../lib/input-fields.js';
import { redactDeep } from '../lib/redact.js';
import { baseUrl } from '../lib/client.js';
import { checkCallingWindow, callingWindowOptionsFromInput } from '../lib/calling-window.js';
import { checkSuppression } from '../lib/suppression.js';
import { checkRetryPolicy, retryPolicyOptionsFromInput } from '../lib/retry-policy.js';

export const createCall = async (z, bundle, { webhookUrl } = {}) => {
  const { payload, key, errors } = buildPayload(bundle.inputData, { webhookUrl });
  if (errors.length) throw new Error(errors.join(' '));

  // A suppressed number must never be dialled, and that includes a dry run.
  // This is the deliberate opposite of the calling-window guard just below:
  // a dry run's purpose is to preview what would happen, and a preview has
  // no timing, so it is safe to show what the calling window would decide at
  // any hour. Suppression is not about timing - it is about the number
  // itself - so echoing back a preview for a number that has been placed on
  // a do-not-call list is not a harmless preview, it is the wrong behavior
  // dressed up as one. Do not "fix" this asymmetry to match the window guard.
  const suppressionCheck = checkSuppression({
    phone: payload.recipients[0].phones[0],
    suppressionList: bundle.inputData.suppression_list,
  });

  if (suppressionCheck.suppressed) {
    return {
      dry_run: isDryRun(bundle.inputData.dry_run),
      call_id: null,
      disposition: 'suppressed',
      disposition_reason: suppressionCheck.reason,
      is_actionable: false,
      lead_state: 'blocked_compliance',
      suppression_enforced: true,
      matched_entry: suppressionCheck.matchedEntry,
      correlation_id: payload.metadata.correlation_id,
    };
  }

  const windowCheck = checkCallingWindow(callingWindowOptionsFromInput(bundle.inputData));
  const retryCheck = checkRetryPolicy(retryPolicyOptionsFromInput(bundle.inputData));

  // A dry run previews the request and places no call, so the two timing
  // guards - whose entire purpose is to stop a call from being placed - have
  // nothing to protect here. Blocking the preview instead of just answering
  // "would this be allowed?" makes it impossible to inspect a Zap outside the
  // window, which is exactly when someone is likely to be building one.
  if (isDryRun(bundle.inputData.dry_run)) {
    return {
      dry_run: true,
      call_id: null,
      disposition: 'outcome_unknown',
      lead_state: 'needs_human',
      preview: redactDeep({ endpoint: `${baseUrl(bundle)}/v1/calls`, idempotency_key: key, payload }),
      calling_window: {
        enforced: windowCheck.enforced,
        allowed: windowCheck.allowed,
        local_hour: windowCheck.localHour,
        reason: windowCheck.reason,
      },
      retry_policy: {
        enforced: retryCheck.enforced,
        allowed: retryCheck.allowed,
        attempts_in_last_day: retryCheck.attemptsInLastDay,
        hours_since_last_attempt: retryCheck.hoursSinceLastAttempt,
        reason: retryCheck.reason,
      },
    };
  }

  if (!windowCheck.allowed) {
    return {
      dry_run: false,
      call_id: null,
      disposition: 'outside_calling_window',
      disposition_reason: windowCheck.reason,
      is_actionable: false,
      lead_state: 'blocked_compliance',
      calling_window_enforced: true,
      local_hour: windowCheck.localHour,
      correlation_id: payload.metadata.correlation_id,
    };
  }

  if (!retryCheck.allowed) {
    return {
      dry_run: false,
      call_id: null,
      disposition: 'retry_policy_blocked',
      disposition_reason: retryCheck.reason,
      is_actionable: false,
      lead_state: 'blocked_compliance',
      retry_policy_enforced: true,
      attempts_in_last_day: retryCheck.attemptsInLastDay,
      hours_since_last_attempt: retryCheck.hoursSinceLastAttempt,
      correlation_id: payload.metadata.correlation_id,
    };
  }

  const response = await z.request({
    method: 'POST',
    url: `${baseUrl(bundle)}/v1/calls`,
    headers: { 'Idempotency-Key': key },
    body: payload,
  });

  return {
    dry_run: false,
    call_id: response.data.id,
    status: response.data.status,
    disposition: 'outcome_unknown',
    lead_state: 'needs_human',
    idempotency_key: key,
    correlation_id: payload.metadata.correlation_id,
  };
};

export default {
  key: 'start_call',
  noun: 'Call',
  display: {
    label: 'Start Call (No Wait)',
    description:
      'Places a CALL-E phone call and returns immediately without waiting for the outcome. Use Find Call Result later to reconcile.',
  },
  operation: {
    inputFields: INPUT_FIELDS,
    perform: (z, bundle) => createCall(z, bundle, {}),
    sample: {
      dry_run: false,
      call_id: 'call_123',
      status: 'queued',
      disposition: 'outcome_unknown',
      lead_state: 'needs_human',
      idempotency_key: '0'.repeat(64),
      correlation_id: 'incident-42',
    },
  },
};
