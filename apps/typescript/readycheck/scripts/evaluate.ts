import { mkdirSync, writeFileSync } from 'node:fs';
import { corpus, CLOCK } from '../tests/corpus';
import { evaluateCandidate } from '../src/domain/evaluator';
import { EVALUATOR_VERSION, SCHEMA_VERSION } from '../src/domain/model';
function metrics(split: 'development' | 'held_out') {
  const rows = corpus
    .filter((s) => s.split === split)
    .map((s) => ({
      id: s.id,
      expected: s.expected,
      actual: evaluateCandidate(s.task, s.candidate, CLOCK).verdict,
    }));
  const tp = rows.filter((r) => r.expected === 'pass' && r.actual === 'pass').length,
    fp = rows.filter((r) => r.expected !== 'pass' && r.actual === 'pass').length,
    tn = rows.filter((r) => r.expected !== 'pass' && r.actual !== 'pass').length,
    fn = rows.filter((r) => r.expected === 'pass' && r.actual !== 'pass').length;
  return {
    split,
    count: rows.length,
    correct: rows.filter((r) => r.expected === r.actual).length,
    tp,
    fp,
    tn,
    fn,
    falseDiscoveryProportion: tp + fp ? fp / (tp + fp) : null,
    falsePositiveRate: fp + tn ? fp / (fp + tn) : null,
    validLeadRecall: tp + fn ? tp / (tp + fn) : null,
    rows,
  };
}
const report = {
  evaluatorVersion: EVALUATOR_VERSION,
  schemaVersion: SCHEMA_VERSION,
  fixtureClock: CLOCK.toISOString(),
  generatedAt: new Date().toISOString(),
  limitations:
    '45 synthetic, self-authored fixtures. Held-out scenarios were designated before implementation testing, but the implementation author can inspect them. No independent reviewer, model extraction benchmark, live calling accuracy, or market validation is established.',
  results: [metrics('development'), metrics('held_out')],
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/evaluation.json', JSON.stringify(report, null, 2));
for (const r of report.results)
  console.log(
    `${r.split}: ${r.correct}/${r.count} exact expected verdicts; TP=${r.tp} FP=${r.fp} TN=${r.tn} FN=${r.fn}; recall=${r.validLeadRecall ?? 'undefined'}`,
  );
console.log(report.limitations);
if (report.results.some((r) => r.correct !== r.count)) process.exitCode = 1;
