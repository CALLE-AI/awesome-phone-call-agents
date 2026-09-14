import { GRADES, type Grade } from './types.ts';
import { gradeCall } from './grade.ts';
import { loadFixtures } from './fixtures.ts';

/**
 * Runs the grader over every labelled fixture and prints a confusion matrix.
 * Zero calls, zero network — the fixtures ARE the eval harness.
 */
export interface EvalRow {
  fixture: string;
  field: string;
  truth: Grade;
  predicted: Grade;
  expected: Grade;
  signals: string[];
  matchesExpected: boolean;
  matchesTruth: boolean;
}

export function runEval(): { rows: EvalRow[]; matrix: Record<Grade, Record<Grade, number>> } {
  const fixtures = loadFixtures();
  const rows: EvalRow[] = [];
  const matrix = Object.fromEntries(
    GRADES.map((t) => [t, Object.fromEntries(GRADES.map((p) => [p, 0]))])
  ) as Record<Grade, Record<Grade, number>>;

  for (const fx of fixtures) {
    const result = gradeCall({
      callId: fx.id,
      recipientId: 'fixture',
      turns: fx.turns,
      fields: fx.fields,
    });
    for (const field of fx.fields) {
      const graded = result.fields.find((f) => f.field === field.field)!;
      const truth = field.truthGrade ?? field.expectedGrade;
      matrix[truth][graded.grade]++;
      rows.push({
        fixture: fx.id,
        field: field.field,
        truth,
        predicted: graded.grade,
        expected: field.expectedGrade,
        signals: graded.signals,
        matchesExpected: graded.grade === field.expectedGrade,
        matchesTruth: graded.grade === truth,
      });
    }
  }
  return { rows, matrix };
}

function printReport(): void {
  const { rows, matrix } = runEval();
  const label = 15;
  const col = 12;

  console.log('provenance-grade — eval over labelled fixtures');
  console.log(`${rows.length} graded fields across ${new Set(rows.map((r) => r.fixture)).size} fixtures\n`);

  console.log('Confusion matrix (rows = ground truth, columns = predicted):\n');
  console.log(['truth \\ pred'.padEnd(label), ...GRADES.map((g) => g.padEnd(col))].join(''));
  for (const t of GRADES) {
    console.log(
      [t.padEnd(label), ...GRADES.map((p) => String(matrix[t][p]).padEnd(col))].join('')
    );
  }

  const correct = rows.filter((r) => r.matchesTruth).length;
  console.log(`\nAccuracy vs ground truth: ${correct}/${rows.length} (${((100 * correct) / rows.length).toFixed(1)}%)`);

  const misses = rows.filter((r) => !r.matchesTruth);
  if (misses.length > 0) {
    console.log('\nMisses (all documented in references/limitations.md):');
    for (const m of misses) {
      console.log(`  ${m.fixture} · ${m.field}: truth=${m.truth} predicted=${m.predicted}`);
    }
  }

  const unexpected = rows.filter((r) => !r.matchesExpected);
  if (unexpected.length > 0) {
    console.log('\nUNEXPECTED behaviour (grader deviates from its own spec):');
    for (const u of unexpected) {
      console.log(`  ${u.fixture} · ${u.field}: expected=${u.expected} predicted=${u.predicted} signals=[${u.signals.join(' | ')}]`);
    }
    process.exitCode = 1;
  } else {
    console.log('\nGrader matches its documented behaviour on every fixture.');
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  printReport();
}
