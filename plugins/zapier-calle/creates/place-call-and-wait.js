import { createCall } from './start-call.js';
import { buildPayload, isDryRun } from '../lib/build-payload.js';
import { INPUT_FIELDS } from '../lib/input-fields.js';
import { flattenResult } from '../lib/flatten-result.js';
import { checkCallingWindow, callingWindowOptionsFromInput } from '../lib/calling-window.js';
import { checkSuppression } from '../lib/suppression.js';
import { checkRetryPolicy, retryPolicyOptionsFromInput } from '../lib/retry-policy.js';
import { parseResultSchema } from '../lib/result-schema.js';
import { toMinConfidenceScore } from '../lib/result-quality.js';
import { toLeadState } from '../lib/lead-state.js';
import { fetchAuthoritativeCall, syntheticEvent } from '../lib/reconcile.js';

const perform = async (z, bundle) => {
  const dryRun = isDryRun(bundle.inputData.dry_run);
  // A callback URL is only useful if createCall is actually going to dial,
  // so every gate that stops it from dialing - suppression, dry run, the
  // calling window, and the retry policy - must also stop the URL from being
  // minted here. Otherwise the Zap would strand itself waiting on a callback
  // that never arrives. Suppression is checked even on a dry run, unlike the
  // two timing guards - see the comment in start-call.js's createCall.
  const { payload, errors } = buildPayload(bundle.inputData, {});
  const suppressed =
    errors.length === 0 &&
    checkSuppression({
      phone: payload.recipients[0].phones[0],
      suppressionList: bundle.inputData.suppression_list,
    }).suppressed;
  const windowCheck = checkCallingWindow(callingWindowOptionsFromInput(bundle.inputData));
  const retryCheck = checkRetryPolicy(retryPolicyOptionsFromInput(bundle.inputData));
  const blocked = suppressed || dryRun || !windowCheck.allowed || !retryCheck.allowed;
  const webhookUrl = blocked ? undefined : z.generateCallbackUrl();
  return createCall(z, bundle, { webhookUrl });
};

// The schema and the confidence floor are inputs to this step, so this action
// can hold the classifier to the caller's own contract - it can tell that a
// field the caller declared required never came back. The Call Completed
// trigger sees the same webhook without either, and gets the weaker
// schemaless check.
const classifierOptions = (bundle) => ({
  resultSchema: parseResultSchema(bundle.inputData && bundle.inputData.result_schema).schema,
  minConfidenceScore: toMinConfidenceScore(
    bundle.inputData && bundle.inputData.min_confidence_score,
  ),
});

const unresumable = (bundle, reason) => ({
  ...bundle.outputData,
  disposition: reason.disposition,
  disposition_reason: reason.text,
  is_actionable: false,
  lead_state: toLeadState(reason.disposition),
  verified: false,
});

const isNonEmptyId = (value) => typeof value === 'string' && value.length > 0;

const performResume = async (z, bundle) => {
  const event = bundle.cleanedRequest;
  const startedCallId = bundle.outputData && bundle.outputData.call_id;

  if (!event || typeof event !== 'object') {
    return unresumable(bundle, {
      disposition: 'outcome_unknown',
      text: 'CALL-E did not deliver a readable webhook payload.',
    });
  }

  // A callback URL is unauthenticated, so an unverifiable callback must fail
  // closed to needs_human rather than fall through to a confirmed result.
  // The id checks below are a cheap first filter, not authentication - they
  // reject a callback that is not even claiming to be about this step's call
  // before spending an API request on it. What actually makes the result
  // trustworthy is the authenticated re-fetch further down.
  const eventCallId = event.data && event.data.id;
  const startedIdKnown = isNonEmptyId(startedCallId);
  const eventIdPresent = isNonEmptyId(eventCallId);

  if (!startedIdKnown) {
    return unresumable(bundle, {
      disposition: 'needs_human',
      text: 'Could not verify the callback: the call id this step started is unknown.',
    });
  }
  if (!eventIdPresent) {
    return unresumable(bundle, {
      disposition: 'needs_human',
      text: 'Could not verify the callback: it carried no call id.',
    });
  }
  if (eventCallId !== startedCallId) {
    return unresumable(bundle, {
      disposition: 'needs_human',
      text: `Callback described a different call (${eventCallId}) than the one this step started.`,
    });
  }

  // Everything above only established that the body is *about* the right call.
  // The body itself is never classified: a forged POST to a discovered callback
  // URL could otherwise carry task_completed, a high confidence and a clean
  // structured_result and be written into a CRM as a real answer. Ask CALL-E,
  // over the connection's own API key, what this call actually did, and
  // classify that instead. The delivered body contributes nothing but its
  // envelope - and an unreadable or unreachable answer means no actionable
  // result at all.
  const authoritative = await fetchAuthoritativeCall(z, bundle, startedCallId);
  if (!authoritative.ok) {
    return unresumable(bundle, {
      disposition: 'needs_human',
      text:
        'A callback arrived for this call, but its outcome could not be confirmed with ' +
        `CALL-E, so it was not trusted. ${authoritative.reason}`,
    });
  }

  const verified = syntheticEvent(authoritative.data, { id: event.id, type: event.type });
  return {
    ...bundle.outputData,
    ...flattenResult(verified, classifierOptions(bundle)),
    verified: true,
  };
};

export default {
  key: 'place_call_and_wait',
  noun: 'Call',
  display: {
    label: 'Place Call and Wait for Outcome',
    description:
      'Places a CALL-E phone call, waits for the call to finish, and returns the transcript, summary, structured result, and a fail-closed disposition.',
  },
  operation: {
    inputFields: INPUT_FIELDS,
    perform,
    performResume,
    sample: {
      disposition: 'confirmed',
      disposition_reason: 'Call completed with a high-confidence validated result.',
      is_actionable: true,
      lead_state: 'qualified',
      verified: true,
      call_id: 'call_123',
      status: 'completed',
      task_completed: true,
      confidence_label: 'high',
      confidence_score: 0.92,
      summary: 'The engineer acknowledged the incident.',
      correlation_id: 'incident-42',
      recipients_total: 1,
      recipients_completed: 1,
      recipients_failed: 0,
      transcript_text: 'bot: Are you able to take this incident?\nuser: Yes, on it.',
    },
  },
};
