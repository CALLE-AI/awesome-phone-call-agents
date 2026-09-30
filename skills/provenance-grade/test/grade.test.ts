import { describe, expect, it } from 'vitest';
import { gradeCall, gradeField } from '../scripts/grade.ts';
import { loadFixtures } from '../scripts/fixtures.ts';
import { runEval } from '../scripts/eval.ts';
import { lintTask } from '../scripts/lint-task.ts';

const fixtures = loadFixtures();

describe('grading over the 24 labelled fixtures', () => {
  it('loads all 24 fixtures', () => {
    expect(fixtures.length).toBe(24);
  });

  for (const fx of fixtures) {
    describe(fx.id, () => {
      const result = gradeCall({
        callId: fx.id,
        recipientId: 'fixture',
        turns: fx.turns,
        fields: fx.fields,
      });

      for (const field of fx.fields) {
        const graded = result.fields.find((f) => f.field === field.field)!;

        it(`grades ${field.field} as ${field.expectedGrade}`, () => {
          expect(graded.grade).toBe(field.expectedGrade);
        });

        if (field.expectSignals) {
          it(`fires signals ${field.expectSignals.join(', ')}`, () => {
            for (const prefix of field.expectSignals!) {
              expect(
                graded.signals.some((s) => s.startsWith(`${prefix}:`)),
                `expected signal ${prefix} in [${graded.signals.join(' | ')}]`
              ).toBe(true);
            }
          });
        }

        it(`unstable flag is ${field.expectUnstable ?? false}`, () => {
          expect(graded.unstable).toBe(field.expectUnstable ?? false);
        });

        if (field.expectedGrade !== 'unstated') {
          it('cites a supporting span from the transcript', () => {
            expect(graded.span.length).toBeGreaterThan(0);
            expect(graded.turnOffset).not.toBeNull();
          });
        } else {
          it('unstated fields carry no span and no signals', () => {
            expect(graded.span).toBe('');
            expect(graded.signals).toEqual([]);
          });
        }
      }
    });
  }
});

describe('fail-closed properties', () => {
  it('a field absent from the transcript is unstated, never graded', () => {
    const graded = gradeField(
      [{ speaker: 'bot', text: 'hello?', offset_seconds: 0 }],
      {
        field: 'eta_days',
        value: null,
        expects: 'duration',
        questionTurn: null,
        answerTurns: [],
        readbackRequested: false,
        critical: true,
      }
    );
    expect(graded.grade).toBe('unstated');
  });

  it('absence of every signal yields asserted at best, never verified', () => {
    const graded = gradeField(
      [
        { speaker: 'bot', text: 'how many business days for delivery?', offset_seconds: 0 },
        { speaker: 'user', text: 'Three business days.', offset_seconds: 4 },
      ],
      {
        field: 'eta_days',
        value: 3,
        expects: 'duration',
        questionTurn: 0,
        answerTurns: [1],
        readbackRequested: false,
        critical: true,
      }
    );
    expect(graded.grade).toBe('asserted');
  });

  it('weakestGrade takes the worst critical field', () => {
    const fx = fixtures.find((f) => f.id === '05-assumed-hedged-weekday')!;
    const result = gradeCall({
      callId: fx.id,
      recipientId: 'r',
      turns: fx.turns,
      fields: fx.fields,
    });
    expect(result.weakestGrade).toBe('assumed');
  });

  it('output omits dedicated person-profile fields, not identifying free text', () => {
    const fx = fixtures[0];
    const result = gradeCall({
      callId: fx.id,
      recipientId: 'org-level-id',
      turns: fx.turns,
      fields: fx.fields,
    });
    const keys = new Set([
      ...Object.keys(result),
      ...result.fields.flatMap((f) => Object.keys(f)),
    ]);
    for (const banned of ['name', 'phone', 'person', 'speaker_id', 'voice']) {
      expect([...keys].some((k) => k.toLowerCase().includes(banned))).toBe(false);
    }
  });
});

describe('confusion matrix vs ground truth', () => {
  const { rows, matrix } = runEval();

  it('at most one miss — the documented Hindi-hedge fixture', () => {
    const misses = rows.filter((r) => !r.matchesTruth);
    expect(misses.length).toBeLessThanOrEqual(1);
    for (const m of misses) {
      expect(m.fixture).toBe('23-codeswitch-hindi-hedge-missed');
    }
  });

  it('never inflates: no assumed/unstated truth is ever predicted verified', () => {
    expect(matrix.assumed.verified).toBe(0);
    expect(matrix.unstated.verified).toBe(0);
    expect(matrix.unstated.asserted).toBe(0);
    expect(matrix.unstated.assumed).toBe(0);
  });
});

describe('pre-call lint', () => {
  it("rewrites 'do you know' into 'can you check'", () => {
    const r = lintTask({
      task: 'Ask the distributor: do you know the delivery date?',
      critical_fields: [],
    });
    expect(r.task).toMatch(/can you check the delivery date/i);
    expect(r.task).not.toMatch(/do you know/i);
  });

  it('adds read-back and corroboration instructions and annotates the schema', () => {
    const r = lintTask({
      task: 'Call the supplier and get the unit price and ETA.',
      result_schema: { type: 'object', properties: { unit_price: { type: 'number' } } },
      critical_fields: ['unit_price', 'eta_days'],
    });
    expect(r.task).toMatch(/read the value back/i);
    expect(r.task).toMatch(/stock count|warehouse/i);
    expect(r.result_schema?.['x-provenance-critical']).toEqual(['unit_price', 'eta_days']);
    expect(r.amendments.length).toBeGreaterThanOrEqual(3);
  });
});
