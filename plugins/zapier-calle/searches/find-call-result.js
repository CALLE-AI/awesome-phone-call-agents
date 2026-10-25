import { flattenResult } from '../lib/flatten-result.js';
import { toMinConfidenceScore } from '../lib/result-quality.js';
import { toLeadState } from '../lib/lead-state.js';
import { syntheticEvent, fetchAuthoritativeCall } from '../lib/reconcile.js';

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
  if (data.object === 'call' ? data.result_status !== 'pending' : !NON_TERMINAL_STATUSES.has(data.status)) return null;

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

  const api = bundle.inputData.calls_api || 'v2';
  const authoritative = await fetchAuthoritativeCall(z, bundle, callId, api);
  if (!authoritative.ok) throw new Error(authoritative.reason);
  const data = authoritative.data;

  // This search is the one surface that never had an authentication problem:
  // it reads the call straight from CALL-E over the connection's API key. That
  // is exactly what the two webhook surfaces now do before classifying, using
  // the same synthetic-event shape.
  const synthetic = syntheticEvent(data);

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
        verified: true,
      },
    ];
  }

  return [{ ...flat, reconciliation_timed_out: false, verified: true }];
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
          'When set, a call whose result is still pending this many minutes after CALL-E created it is reported as needs_human rather than outcome_unknown. Put a Zapier Delay step before this search to build a timeout: Zapier itself holds a waiting callback step for up to 30 days and provides no timeout hook. Leave blank to disable.',
      },
      {
        key: 'calls_api',
        label: 'Calls API Version',
        type: 'string',
        required: true,
        default: 'v2',
        choices: { v2: 'Calls v2', v1: 'Legacy call tasks (read only)' },
        helpText: 'Use the interface that created the API Call ID. Historical v1 IDs cannot be read through v2.',
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
      verified: true,
    },
  },
};
