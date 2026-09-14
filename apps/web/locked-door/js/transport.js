/**
 * CALL TRANSPORT — one interface, two implementations.
 *
 *   SimulatedFacilityTransport  ACTIVE.   Plays a deterministic recorded-style
 *                                         conversation from ground truth.
 *   CalleTelephonyAdapter       DISABLED. Wired, request shape documented and
 *                                         rendered in the UI, but hard-refuses
 *                                         to dial. This build has never placed
 *                                         and cannot place a real phone call.
 *
 * The refusal is structural, not a flag someone forgot to flip: `placeCall`
 * throws before constructing a network request, and there is no fetch() call to
 * a telephony host anywhere in this codebase.
 */

import { buildTranscript, materialize, decideOutcome, DISCLOSURE } from './dialogue.js';
import { hashString } from './rng.js';

/** Non-cryptographic 64-bit-ish digest, for display/idempotency demonstration only. */
export function displayDigest(str) {
  const a = hashString(str);
  const b = hashString(str + '\u0001salt');
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 16);
}

export function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const core = digits.length > 10 ? digits.slice(-10) : digits;
  if (core.length !== 10) return null;
  return `+1${core}`;
}

/**
 * The exact body the real adapter would POST. Field order and shape mirror
 * `packages/calle/src/operation.ts::canonicalCreateCallRequest` in this repo, so
 * the disabled adapter is wire-compatible with the service that already exists.
 */
export function buildCanonicalRequest(plan) {
  const idempotencyKey = `calle_${plan.runId}_${plan.facilityId}_${displayDigest(
    plan.facilityId + plan.questions.join(',') + plan.runId,
  )}`;
  const body = [
    ['idempotencyKey', idempotencyKey],
    ['runId', plan.runId],
    ['facilityId', plan.facilityId],
    ['phoneE164', plan.phoneE164],
    ['disclosure', plan.disclosure],
    ['questions', plan.questions],
    ['resultSchemaVersion', plan.resultSchemaVersion],
    ['maximumAttempts', plan.maximumAttempts],
    ['approvedPlanDigest', plan.approvedPlanDigest],
  ];
  const canonical = JSON.stringify(body);
  return {
    method: 'POST',
    url: 'https://api.heycall-e.com/v1/calls',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      authorization: 'Bearer ${CALLE_API_KEY}',
    },
    idempotencyKey,
    canonicalBody: canonical,
    requestBodyDigest: displayDigest(canonical),
  };
}

export class CallTransport {
  get isReal() {
    return false;
  }
  // eslint-disable-next-line no-unused-vars
  placeCall(_plan, _hooks) {
    throw new Error('CallTransport is abstract');
  }
}

/** Real telephony. Present, wired, and refusing. */
export class CalleTelephonyAdapter extends CallTransport {
  constructor() {
    super();
    this.enabled = false; // never set true in this build
    this.name = 'CALL-E telephony adapter';
  }
  get isReal() {
    return true;
  }
  describe(plan) {
    return buildCanonicalRequest(plan);
  }
  /**
   * Refuses SYNCHRONOUSLY, and deliberately so.
   *
   * If this were `async`, the refusal would be delivered as a rejected promise,
   * and a caller that forgot to `await` would sail straight past it with nothing
   * but an unhandled-rejection warning somewhere off-screen. On the one boundary
   * in this codebase that must never be crossed quietly, "you only find out if
   * you were listening" is not good enough. A plain throw cannot be ignored by
   * an unawaited call, and still rejects the enclosing promise when it IS
   * awaited, so both call styles fail loudly.
   */
  placeCall(plan) {
    throw new Error(
      'REAL_TELEPHONY_DISABLED: this build is not permitted to place phone calls. ' +
        `Would have sent POST https://api.heycall-e.com/v1/calls with idempotency-key ${
          this.describe(plan).idempotencyKey
        }.`,
    );
  }
}

/* ------------------------------------------------------------- retries --- */
/**
 * Retry policy. A facility gets at most MAX_ATTEMPTS dials across the whole run,
 * with exponential backoff, and only for outcomes that could plausibly differ
 * next time. A disconnected number is terminal — retrying it burns budget.
 */
export const MAX_ATTEMPTS = 3;
export const BACKOFF_REAL_MINUTES = [0, 45, 180];
export const RETRYABLE = new Set(['no_answer', 'busy', 'voicemail', 'ivr_dead_end']);
export const TERMINAL = new Set(['disconnected', 'no_number', 'connected', 'connected_via_ivr']);

export class SimulatedFacilityTransport extends CallTransport {
  constructor(groundTruthById, seed = 'calle-sim-v1') {
    super();
    this.gt = groundTruthById;
    this.seed = seed;
    this.name = 'Deterministic simulated facility';
  }
  get isReal() {
    return false;
  }

  /**
   * Runs the retry loop for one facility and returns every attempt made.
   * `hooks.onTurn(turn, ctx)` streams turns for the live UI; `hooks.delay(ms)`
   * controls playback speed.
   */
  async placeCall(plan, hooks = {}) {
    const gt = this.gt.get(plan.facilityId);
    const attempts = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const outcome = decideOutcome(gt, attempt, this.seed);
      const turns = buildTranscript(gt, plan.facility, plan.questions, attempt, this.seed, outcome);
      const mat = materialize(turns);

      if (hooks.onAttemptStart) hooks.onAttemptStart({ attempt, outcome, plan });
      if (hooks.onTurn) {
        for (const t of mat.turns) {
          await hooks.onTurn(t, { attempt, outcome, plan });
        }
      }

      attempts.push({
        attempt,
        outcome,
        backoffMinutes: BACKOFF_REAL_MINUTES[attempt],
        transcript: mat,
        connected: outcome === 'connected' || outcome === 'connected_via_ivr',
      });

      if (!RETRYABLE.has(outcome)) break;
      if (attempt === MAX_ATTEMPTS - 1) break;
      if (hooks.onBackoff) await hooks.onBackoff({ attempt, nextInMinutes: BACKOFF_REAL_MINUTES[attempt + 1] });
    }
    return attempts;
  }
}

export { DISCLOSURE };
