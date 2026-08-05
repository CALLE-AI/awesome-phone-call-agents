import { flattenResult } from '../lib/flatten-result.js';
import { baseUrl } from '../lib/client.js';
import { toMinConfidenceScore } from '../lib/result-quality.js';
import { toLeadState } from '../lib/lead-state.js';

const EVENT_TYPE_BY_STATUS = {
  completed: 'call.completed',
  failed: 'call.failed',
  canceled: 'call.completed',
  queued: 'call.completed',
  in_progress: 'call.completed',
};

const NON_TERMINAL_STATUSES = new Set(['queued', 'in_progress']);
const MS_PER_MINUTE = 60000;

function toMinutes(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Zapier holds a callback step for up to 30 days and offers no timeout hook -
// if CALL-E never POSTs back, `performResume` is simply never invoked, so
// "Place Call and Wait" cannot time itself out from the inside. This search
// is the outside: pair it with a Zapier Delay step and it will declare a call
// stalled rather than leaving a row in limbo forever. The elapsed time is
// measured from CALL-E's own `created_at` rather than from when the Zap ran,
// so a delayed or re-run reconciliation step still measures the real age of
// the call.
function reconciliationTimedOut(data, maxWaitMinutes, now) {
  if (maxWaitMinutes === null) return null;
  if (!NON_TERMINAL_STATUSES.has(data.status)) return null;

  const createdAt = Date.parse(data.created_at);
  if (!Number.isFinite(createdAt)) {
    return 'Call has not reached a terminal state and its creation time could not be read, so its age is unknown.';
  }

  const elapsedMinutes = (now - createdAt) / MS_PER_MINUTE;
  if (elapsedMinutes <= maxWaitMinutes) return null;

  return (
    `Call is still ${data.status} ${elapsedMinutes.toFixed(1)} minutes after it was created, ` +
    `past the ${maxWaitMinutes} minute reconciliation limit. Treat it as stalled and handle it by hand.`
  );
}

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

  // No result_schema is available here: this search can reconcile a call
  // placed from anywhere, including CALL-E's CLI, so there is no declared
  // contract to check the result against.
  const flat = flattenResult(synthetic, {
    minConfidenceScore: toMinConfidenceScore(bundle.inputData.min_confidence_score),
  });

  const timedOut = reconciliationTimedOut(
    data,
    toMinutes(bundle.inputData.max_wait_minutes),
    Date.now(),
  );
  if (timedOut) {
    return [
      {
        ...flat,
        disposition: 'needs_human',
        disposition_reason: timedOut,
        is_actionable: false,
        lead_state: toLeadState('needs_human'),
        reconciliation_timed_out: true,
      },
    ];
  }

  return [{ ...flat, reconciliation_timed_out: false }];
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
      {
        key: 'max_wait_minutes',
        label: 'Reconciliation Limit (minutes)',
        type: 'integer',
        required: false,
        helpText:
          'When set, a call still queued or in progress this many minutes after CALL-E created it is reported as needs_human rather than outcome_unknown. Put a Zapier Delay step before this search to build a timeout: Zapier itself holds a waiting callback step for up to 30 days and provides no timeout hook. Leave blank to disable.',
      },
      {
        key: 'min_confidence_score',
        label: 'Minimum Confidence Score',
        type: 'string',
        required: false,
        default: '0.6',
        helpText:
          'A result is only marked confirmed when CALL-E\'s 0-1 confidence score is at least this value. Set to 0 to accept the confidence label alone.',
      },
    ],
    perform,
    sample: {
      disposition: 'confirmed',
      lead_state: 'qualified',
      call_id: 'call_123',
      status: 'completed',
      is_actionable: true,
      reconciliation_timed_out: false,
    },
  },
};
