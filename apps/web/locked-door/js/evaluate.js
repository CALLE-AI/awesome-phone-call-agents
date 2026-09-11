/**
 * HONEST EVALUATION.
 *
 * The simulator knows the truth, so every number on the evaluation panel is a
 * real measurement against it — not a self-report. Ground truth is read ONLY
 * here and in the simulator; the planner, extractor and publisher never see it.
 *
 * Definitions, stated plainly because these terms get abused:
 *
 *   attempted   (facility, field) pairs the plan set out to verify on facilities
 *               that were actually dialed. Includes calls that never connected.
 *   grounded    attempted pairs where a transcript span produced a typed value.
 *   correct     grounded pairs whose value matches ground truth after canonicalisation.
 *   precision   correct / grounded          "when it speaks, is it right?"
 *   recall      correct / attempted         "of the facts it set out to fix, how many did it fix?"
 *   unknown     1 - grounded / attempted    "the price of refusing to guess"
 *   false publish  published rows whose value contradicts ground truth / published rows
 */

import { canonicalize, ROUTE } from './publish.js';
import { valuesEqual } from './extract.js';
import { FIELDS } from './risk.js';

export function evaluateRun({ rows, truthById, riskRowFor, publishedRows, autoPublishedRows }) {
  const perField = {};
  for (const f of FIELDS) perField[f] = { attempted: 0, grounded: 0, correct: 0, wrong: 0, unknown: 0 };

  let attempted = 0;
  let grounded = 0;
  let correct = 0;
  let wrong = 0;
  let harmRealized = 0;
  let harmForfeited = 0;

  // Where did the WRONG values end up? This is the load-bearing safety claim:
  // the extractor does make mistakes, and the router is supposed to catch every
  // one of them before it can reach the directory on the machine's own
  // authority. Measured, not asserted.
  const wrongRouting = { total: 0, toReview: 0, toAuto: 0, examples: [] };

  for (const r of rows) {
    const t = truthById.get(r.facilityId);
    if (!t) continue;
    const truthCanon = canonicalize(r.field, t.truth[r.field]);
    const pf = perField[r.field];
    attempted++;
    pf.attempted++;

    if (r.newValue === 'unknown') {
      pf.unknown++;
      const risk = riskRowFor(r.facilityId, r.field);
      harmForfeited += risk.harm * risk.pStale;
      continue;
    }
    grounded++;
    pf.grounded++;
    const ok = truthCanon !== null && valuesEqual(r.newCanonical, truthCanon);
    if (ok) {
      correct++;
      pf.correct++;
      const risk = riskRowFor(r.facilityId, r.field);
      harmRealized += risk.harm * risk.pStale;
    } else {
      wrong++;
      pf.wrong++;
      wrongRouting.total++;
      if (r.route === ROUTE.REVIEW) wrongRouting.toReview++;
      else if (r.route === ROUTE.AUTO) wrongRouting.toAuto++;
      if (wrongRouting.examples.length < 8)
        wrongRouting.examples.push({
          facilityId: r.facilityId,
          field: r.field,
          extracted: r.newCanonical,
          truth: truthCanon,
          route: r.route,
          confidence: r.confidence,
          quote: r.evidence?.quote ?? null,
        });
    }
  }

  const falsePublish = countFalsePublishes(publishedRows, truthById);
  const falseAuto = countFalsePublishes(autoPublishedRows, truthById);

  return {
    attempted,
    grounded,
    correct,
    wrong,
    unknown: attempted - grounded,
    precision: grounded ? correct / grounded : 0,
    recall: attempted ? correct / attempted : 0,
    unknownRate: attempted ? (attempted - grounded) / attempted : 0,
    harmRealized,
    harmForfeited,
    falsePublish: {
      published: falsePublish.total,
      wrong: falsePublish.wrong,
      rate: falsePublish.total ? falsePublish.wrong / falsePublish.total : 0,
      examples: falsePublish.examples,
    },
    falsePublishAutoOnly: {
      published: falseAuto.total,
      wrong: falseAuto.wrong,
      rate: falseAuto.total ? falseAuto.wrong / falseAuto.total : 0,
    },
    wrongValueRouting: {
      ...wrongRouting,
      // 1.0 means every wrong value the extractor produced was held for a human.
      caughtRate: wrongRouting.total ? wrongRouting.toReview / wrongRouting.total : 1,
    },
    perField: Object.fromEntries(
      Object.entries(perField).map(([k, v]) => [
        k,
        {
          ...v,
          precision: v.grounded ? v.correct / v.grounded : null,
          recall: v.attempted ? v.correct / v.attempted : null,
          unknownRate: v.attempted ? v.unknown / v.attempted : null,
        },
      ]),
    ),
  };
}

function countFalsePublishes(publishedRows, truthById) {
  let wrong = 0;
  const examples = [];
  for (const p of publishedRows) {
    const t = truthById.get(p.facilityId);
    if (!t) continue;
    const truthCanon = canonicalize(p.field, t.truth[p.field]);
    if (truthCanon === null) continue;
    if (!valuesEqual(p.newCanonical, truthCanon)) {
      wrong++;
      if (examples.length < 6)
        examples.push({
          facilityId: p.facilityId,
          field: p.field,
          published: p.newCanonical,
          truth: truthCanon,
          confidence: p.confidence,
          hedged: !!p.hedged,
          quote: p.evidence?.quote ?? null,
        });
    }
  }
  return { total: publishedRows.length, wrong, examples };
}

/**
 * Ungrounded-publish check: the property the citation rule is supposed to make
 * impossible. Counted, not assumed.
 */
export function countUngroundedPublishes(publishedRows) {
  return publishedRows.filter(
    (p) =>
      p.newValue === 'unknown' ||
      !p.evidence ||
      !p.evidence.span ||
      typeof p.evidence.span.start !== 'number' ||
      p.evidence.span.end <= p.evidence.span.start ||
      !p.evidence.quote,
  ).length;
}
