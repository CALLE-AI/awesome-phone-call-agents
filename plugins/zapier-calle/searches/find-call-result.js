import { flattenResult } from '../lib/flatten-result.js';
import { baseUrl } from '../lib/client.js';

const EVENT_TYPE_BY_STATUS = {
  completed: 'call.completed',
  failed: 'call.failed',
  canceled: 'call.completed',
  queued: 'call.completed',
  in_progress: 'call.completed',
};

const perform = async (z, bundle) => {
  const callId = bundle.inputData.call_id;
  if (!callId) throw new Error('A CALL-E call id is required to look up a result.');

  const response = await z.request({ url: `${baseUrl(bundle)}/v1/calls/${encodeURIComponent(callId)}` });
  const data = response.data;

  const synthetic = {
    id: `lookup_${callId}`,
    type: EVENT_TYPE_BY_STATUS[data.status] || 'call.completed',
    created_at: data.completed_at || data.created_at,
    data,
  };

  return [flattenResult(synthetic)];
};

export default {
  key: 'find_call_result',
  noun: 'Call Result',
  display: {
    label: 'Find Call Result',
    description:
      'Looks up a CALL-E call by id and returns its current disposition. Use this to reconcile a call whose webhook was missed or whose waiting Zap step was interrupted.',
  },
  operation: {
    inputFields: [
      {
        key: 'call_id',
        label: 'Call ID',
        type: 'string',
        required: true,
        helpText: 'The CALL-E call id returned by Start Call or Place Call and Wait.',
      },
    ],
    perform,
    sample: {
      disposition: 'confirmed',
      call_id: 'call_123',
      status: 'completed',
      is_actionable: true,
    },
  },
};
