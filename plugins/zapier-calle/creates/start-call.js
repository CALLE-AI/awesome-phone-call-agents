import { buildPayload, isDryRun } from '../lib/build-payload.js';
import { INPUT_FIELDS } from '../lib/input-fields.js';
import { redactDeep } from '../lib/redact.js';
import { baseUrl } from '../lib/client.js';
import { checkCallingWindow, callingWindowOptionsFromInput } from '../lib/calling-window.js';

export const createCall = async (z, bundle, { webhookUrl } = {}) => {
  const { payload, key, errors } = buildPayload(bundle.inputData, { webhookUrl });
  if (errors.length) throw new Error(errors.join(' '));

  const windowCheck = checkCallingWindow(callingWindowOptionsFromInput(bundle.inputData));

  // A dry run previews the request and places no call, so the calling-window
  // guard - whose entire purpose is to stop a call from being placed - has
  // nothing to protect here. Blocking the preview instead of just answering
  // "would this be allowed?" makes it impossible to inspect a Zap outside the
  // window, which is exactly when someone is likely to be building one.
  if (isDryRun(bundle.inputData.dry_run)) {
    return {
      dry_run: true,
      call_id: null,
      disposition: 'outcome_unknown',
      preview: redactDeep({ endpoint: `${baseUrl(bundle)}/v1/calls`, idempotency_key: key, payload }),
      calling_window: {
        enforced: windowCheck.enforced,
        allowed: windowCheck.allowed,
        local_hour: windowCheck.localHour,
        reason: windowCheck.reason,
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
      calling_window_enforced: true,
      local_hour: windowCheck.localHour,
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
      idempotency_key: '0'.repeat(64),
      correlation_id: 'incident-42',
    },
  },
};
