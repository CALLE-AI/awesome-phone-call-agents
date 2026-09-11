/**
 * THE PLANNER — turning per-field risk into a bounded call queue.
 *
 * This is not a sort. Two things make it an optimisation:
 *
 *  1. ONE CALL VERIFIES SEVERAL FIELDS. The unit of cost is a call, not a field,
 *     so the value of a facility is a *set* value, and the set has diminishing
 *     returns inside it: a caller gets a clean answer to question 1, a decent
 *     answer to question 3, and by question 6 the staff member is done. That is
 *     modelled by an explicit per-question decay, so the 6th question on a
 *     high-risk facility can be worth less than the 1st question on a lower one.
 *
 *  2. FACILITIES OVERLAP. Duplicate listings share a phone line, so calling one
 *     already answers most of the other's questions. Selecting a facility
 *     therefore *changes the value of other facilities*, which is what forces
 *     re-evaluation each round instead of a single ranking pass.
 *
 * The objective is monotone and submodular, so greedy carries the standard
 * (1 - 1/e) guarantee against the optimal bounded set. We do not claim optimality.
 */

import { FIELDS, LINE_PROFILE } from './risk.js';

/** Value retained by the k-th question asked in a single call (k is 0-based). */
export const QUESTION_DECAY = 0.82;
/** Hard cap on questions per call: a disclosed script that runs long gets hung up on. */
export const MAX_QUESTIONS_PER_CALL = 6;
/** Residual value of a field already covered by a selected facility on the same line. */
export const SHARED_LINE_RESIDUAL = 0.25;

/**
 * Marginal expected harm reduction of calling `facilityId` given already-selected set.
 * `covered` maps "facilityKey:field" -> true for fields a selected call already reaches.
 */
export function marginalGain(facilityId, ctx, covered) {
  const line = ctx.lineClassById(facilityId);
  const profile = LINE_PROFILE[line] ?? LINE_PROFILE.direct;
  const pConnect = profile.connect;
  if (pConnect <= 0) return { gain: 0, questions: [], pConnect: 0, line };

  const lineKey = ctx.lineKeyById(facilityId);

  const scored = FIELDS.map((field) => {
    const row = ctx.rowFor(facilityId, field);
    const residual = covered.has(`${lineKey}:${field}`) ? SHARED_LINE_RESIDUAL : 1;
    return { field, base: row.ehr, residual, value: row.ehr * residual, row };
  })
    .filter((q) => q.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_QUESTIONS_PER_CALL);

  let gain = 0;
  const questions = scored.map((q, k) => {
    const decay = Math.pow(QUESTION_DECAY, k);
    const contribution = q.value * decay;
    gain += contribution;
    return { ...q, rank: k, decay, contribution };
  });

  return { gain: gain * pConnect, questions, pConnect, line };
}

/**
 * Greedy-with-diminishing-returns selection under a hard call budget.
 * Re-scores every remaining candidate on every round because selection mutates
 * the value of the rest.
 */
export function planGreedy(facilities, ctx, budget) {
  const covered = new Set();
  const chosen = [];
  const remaining = new Map(facilities.map((f) => [f.id, f]));
  const rounds = [];

  while (chosen.length < budget && remaining.size > 0) {
    let best = null;
    for (const id of remaining.keys()) {
      const m = marginalGain(id, ctx, covered);
      if (!best || m.gain > best.m.gain) best = { id, m };
    }
    if (!best || best.m.gain <= 1e-9) break; // nothing left worth a call
    remaining.delete(best.id);
    const lineKey = ctx.lineKeyById(best.id);
    for (const q of best.m.questions) covered.add(`${lineKey}:${q.field}`);
    chosen.push({
      facilityId: best.id,
      rank: chosen.length + 1,
      expectedGain: best.m.gain,
      pConnect: best.m.pConnect,
      line: best.m.line,
      questions: best.m.questions.map((q) => ({
        field: q.field,
        ehr: q.base,
        residual: q.residual,
        decay: q.decay,
        contribution: q.contribution,
        pStale: q.row.pStale,
        harm: q.row.harm,
        observability: q.row.observability,
        ageDays: q.row.ageDays,
        staleReason: q.row.staleReason,
        publishedValue: q.row.publishedValue,
      })),
    });
    rounds.push({ round: chosen.length, picked: best.id, gain: best.m.gain });
  }

  return {
    strategy: 'risk_greedy',
    budget,
    calls: chosen,
    expectedHarmReduction: chosen.reduce((a, c) => a + c.expectedGain, 0),
    rounds,
  };
}

/**
 * BASELINE: "call the oldest listings first" — what a directory team actually
 * does today. Ranks facilities by the age of their oldest published field and
 * takes the first `budget`. It is scored with the *same* objective so the
 * comparison is apples to apples; it loses because age alone ignores harm,
 * ignores whether a phone call can even observe the field, and spends budget on
 * duplicate listings and dead lines.
 */
export function planOldestFirst(facilities, ctx, budget) {
  const withPhone = facilities.filter((f) => f.phone); // a human would skip blank numbers
  const ranked = [...withPhone].sort((a, b) => oldestAge(b, ctx) - oldestAge(a, ctx));
  const chosen = [];
  const covered = new Set();
  for (const f of ranked) {
    if (chosen.length >= budget) break;
    const m = marginalGain(f.id, ctx, covered);
    const lineKey = ctx.lineKeyById(f.id);
    for (const q of m.questions) covered.add(`${lineKey}:${q.field}`);
    chosen.push({
      facilityId: f.id,
      rank: chosen.length + 1,
      expectedGain: m.gain,
      pConnect: m.pConnect,
      line: m.line,
      questions: m.questions.map((q) => ({ field: q.field, contribution: q.contribution })),
    });
  }
  return {
    strategy: 'naive_oldest_first',
    budget,
    calls: chosen,
    expectedHarmReduction: chosen.reduce((a, c) => a + c.expectedGain, 0),
  };
}

function oldestAge(facility, ctx) {
  let max = -1;
  for (const field of FIELDS) {
    const row = ctx.rowFor(facility.id, field);
    const a = row.ageDays === null ? 9999 : row.ageDays;
    if (a > max) max = a;
  }
  return max;
}

/** Total EHR available in the directory if every facility could be called. */
export function totalAvailableHarm(facilities, ctx) {
  let total = 0;
  for (const f of facilities) {
    for (const field of FIELDS) total += ctx.rowFor(f.id, field).ehr;
  }
  return total;
}
