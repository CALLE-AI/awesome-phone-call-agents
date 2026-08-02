import { buildPayload, INPUT_FIELDS } from '../lib/build-payload.js';
import { redactDeep } from '../lib/redact.js';
import { baseUrl } from '../lib/client.js';

export const createCall = async (z, bundle, { webhookUrl } = {}) => {
  const { payload, key, errors } = buildPayload(bundle.inputData, { webhookUrl });
  if (errors.length) throw new Error(errors.join(' '));

  if (bundle.inputData.dry_run === true || bundle.inputData.dry_run === 'true') {
    return {
      dry_run: true,
      call_id: null,
      disposition: 'outcome_unknown',
      preview: redactDeep({ endpoint: `${baseUrl(bundle)}/v1/calls`, idempotency_key: key, payload }),
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
    important: false,
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
