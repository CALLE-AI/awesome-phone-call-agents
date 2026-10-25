import { createCall } from './start-call.js';
import { buildPayload, isDryRun } from '../lib/build-payload.js';
import { INPUT_FIELDS } from '../lib/input-fields.js';
import { flattenResult } from '../lib/flatten-result.js';
import { checkCallingWindow, callingWindowOptionsFromInput } from '../lib/calling-window.js';
import { checkSuppression } from '../lib/suppression.js';
import { checkRetryPolicy, retryPolicyOptionsFromInput } from '../lib/retry-policy.js';
import { parseResultSchema, parseLegacyResultSchema } from '../lib/result-schema.js';
import { toMinConfidenceScore } from '../lib/result-quality.js';
import { toLeadState } from '../lib/lead-state.js';
import { fetchAuthoritativeCall, syntheticEvent, callbackApi } from '../lib/reconcile.js';

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
      phone: payload.phone,
      suppressionList: bundle.inputData.suppression_list,
    }).suppressed;
  const windowCheck = checkCallingWindow(callingWindowOptionsFromInput(bundle.inputData));
  const retryCheck = checkRetryPolicy(retryPolicyOptionsFromInput(bundle.inputData));
  const blocked = errors.length > 0 || suppressed || dryRun || !windowCheck.allowed || !retryCheck.allowed;
  // Zapier supplies one callback URL per execution event; retries must reuse that event.
  const webhookUrl = blocked ? undefined : z.generateCallbackUrl();
  if (!blocked && (typeof webhookUrl !== 'string' || !webhookUrl)) {
    throw new Error('Zapier supplied no callback URL; no call was placed.');
  }
  return createCall(z, bundle, { webhookUrl });
};

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
  const api = callbackApi(event);
  if (!api || (bundle.outputData?.calls_api && bundle.outputData.calls_api !== api)) {
    return unresumable(bundle, { disposition: 'needs_human', text: 'Callback interface did not match the original Call.' });
  }
  const parsed = (api === 'v1' ? parseLegacyResultSchema : parseResultSchema)(bundle.inputData?.result_schema);
  if (parsed.errors.length) {
    return unresumable(bundle, { disposition: 'needs_human', text: 'The original result schema could not be read; reconcile this Call manually.' });
  }
  const authoritative = await fetchAuthoritativeCall(z, bundle, startedCallId, api);
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
    ...flattenResult(verified, {
      resultSchema: parsed.schema,
      minConfidenceScore: toMinConfidenceScore(bundle.inputData?.min_confidence_score),
    }),
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
      disposition_reason: 'Business confirmation is explicit and its quote matches the recipient transcript.',
      is_actionable: true,
      lead_state: 'qualified',
      verified: true,
      call_id: 'call_123',
      calls_api: 'v2',
      telephone_call_id: null,
      status: 'completed',
      call_outcome: 'completed',
      result_status: 'available',
      result_business_confirmed: true,
      result_business_confirmed_quote: 'Yes, on it.',
      summary: 'The engineer acknowledged the incident.',
      correlation_id: 'incident-42',
      transcript_text: 'bot: Are you able to take this incident?\nuser: Yes, on it.',
    },
  },
};
