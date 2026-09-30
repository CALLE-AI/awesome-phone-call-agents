import type {
  CandidateResult,
  CaseRecord,
  Fact,
  LearningSummary,
  RepairRule,
} from '../src/domain/model';
import { REPAIR_VERSION, repairLabels, repairRules } from '../src/domain/repairs';
import { sha256 } from './auth';
import type { Store } from './store';

const instructions: Record<RepairRule, string> = {
  explicit_usd:
    'Extraction reminder from reviewed corrections: convert the actual USD amount to integer cents (multiply dollars by 100). Never substitute the requested budget. Preserve estimates, conditions and price basis.',
  source_reference:
    'Extraction reminder from reviewed corrections: use the zero-based index in the full transcript array, counting both caller and recipient segments, for the recipient segment containing the exact quote. Never count recipient segments alone. Do not cite the caller or remove qualifications.',
};

export function learningSummary(store: Store, owner: string): LearningSummary {
  const rows = store.db
    .prepare(
      'SELECT rule, outcome, COUNT(*) AS count FROM correction_feedback WHERE owner_id=? GROUP BY rule,outcome',
    )
    .all(owner);
  const rules = repairRules.map((id) => {
    const accepted = Number(
      rows.find((r) => r.rule === id && r.outcome === 'accepted')?.count || 0,
    );
    const rejected = Number(
      rows.find((r) => r.rule === id && r.outcome === 'rejected')?.count || 0,
    );
    return {
      id,
      label: repairLabels[id],
      accepted,
      rejected,
      status: rejected ? ('paused' as const) : accepted ? ('active' as const) : ('trial' as const),
    };
  });
  return {
    version: sha256(JSON.stringify([REPAIR_VERSION, rules.map((r) => [r.id, r.status])])),
    rules,
  };
}

export function learningInstructions(summary: LearningSummary): string {
  return summary.rules
    .filter((r) => r.status === 'active')
    .map((r) => instructions[r.id])
    .join('\n');
}

export function disabledRepairs(summary: LearningSummary): RepairRule[] {
  return summary.rules.filter((r) => r.status === 'paused').map((r) => r.id);
}

/** Store outcomes, never recipient wording or free-text correction reasons.
 * One source fact has one vote per rule even when copied across revisions. */
export function learnFromReview(
  store: Store,
  owner: string,
  record: CaseRecord,
  result: CandidateResult,
  fact: Fact,
  action: 'confirm' | 'reject' | 'correct',
  corrected?: Fact,
) {
  if (record.mode !== 'live' || result.mode !== 'live') return;
  const source =
    fact.sourceId === result.sourceId ? result.transcript : result.sources?.[fact.sourceId];
  if (
    !source?.[fact.turn] ||
    source[fact.turn].speaker !== 'recipient' ||
    !source[fact.turn].text.includes(fact.raw)
  )
    return;
  for (const repair of fact.repairs || []) {
    if (!repairRules.includes(repair.rule)) continue;
    const retained =
      action === 'correct' &&
      corrected &&
      (repair.rule === 'explicit_usd'
        ? corrected.value === fact.value
        : corrected.turn === fact.turn);
    store.db
      .prepare(
        `INSERT INTO correction_feedback(owner_id,case_id,source_id,fact_id,rule,outcome,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,case_id,source_id,fact_id,rule)
      DO UPDATE SET outcome=CASE WHEN correction_feedback.outcome='rejected' THEN 'rejected' ELSE excluded.outcome END,updated_at=excluded.updated_at`,
      )
      .run(
        owner,
        record.id,
        fact.sourceId,
        fact.id,
        repair.rule,
        action === 'confirm' || retained ? 'accepted' : 'rejected',
        new Date().toISOString(),
      );
  }
}
