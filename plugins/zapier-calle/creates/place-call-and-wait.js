import { createCall } from './start-call.js';
import { INPUT_FIELDS, isDryRun } from '../lib/build-payload.js';
import { flattenResult } from '../lib/flatten-result.js';

const perform = async (z, bundle) => {
  const dryRun = isDryRun(bundle.inputData.dry_run);
  const webhookUrl = dryRun ? undefined : z.generateCallbackUrl();
  return createCall(z, bundle, { webhookUrl });
};

const isNonEmptyId = (value) => typeof value === 'string' && value.length > 0;

const performResume = async (z, bundle) => {
  const event = bundle.cleanedRequest;
  const startedCallId = bundle.outputData && bundle.outputData.call_id;

  if (!event || typeof event !== 'object') {
    return {
      ...bundle.outputData,
      disposition: 'outcome_unknown',
      disposition_reason: 'CALL-E did not deliver a readable webhook payload.',
      is_actionable: false,
    };
  }

  // A callback URL is unauthenticated, so an unverifiable callback must fail
  // closed to needs_human rather than fall through to a confirmed result.
  const eventCallId = event.data && event.data.id;
  const startedIdKnown = isNonEmptyId(startedCallId);
  const eventIdPresent = isNonEmptyId(eventCallId);

  if (!startedIdKnown) {
    return {
      ...bundle.outputData,
      disposition: 'needs_human',
      disposition_reason: 'Could not verify the callback: the call id this step started is unknown.',
      is_actionable: false,
    };
  }
  if (!eventIdPresent) {
    return {
      ...bundle.outputData,
      disposition: 'needs_human',
      disposition_reason: 'Could not verify the callback: it carried no call id.',
      is_actionable: false,
    };
  }
  if (eventCallId !== startedCallId) {
    return {
      ...bundle.outputData,
      disposition: 'needs_human',
      disposition_reason: `Callback described a different call (${eventCallId}) than the one this step started.`,
      is_actionable: false,
    };
  }

  return { ...bundle.outputData, ...flattenResult(event) };
};

export default {
  key: 'place_call_and_wait',
  noun: 'Call',
  display: {
    label: 'Place Call and Wait for Outcome',
    description:
      'Places a CALL-E phone call, waits for the call to finish, and returns the transcript, summary, structured result, and a fail-closed disposition.',
    important: true,
  },
  operation: {
    inputFields: INPUT_FIELDS,
    perform,
    performResume,
    sample: {
      disposition: 'confirmed',
      disposition_reason: 'Call completed with a high-confidence validated result.',
      is_actionable: true,
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
