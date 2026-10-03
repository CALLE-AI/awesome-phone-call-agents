import type { CandidateResult, Fact, Task } from '../src/domain/model';
import { defaultTask } from '../src/domain/templates';
import { sampleResults } from '../src/domain/samples';
export const CLOCK = new Date('2026-09-09T15:00:00Z');
export interface Scenario {
  id: string;
  split: 'development' | 'held_out';
  task: Task;
  candidate: CandidateResult;
  expected: 'pass' | 'fail' | 'unknown';
  critical: boolean;
}
function base(template: Task['template']) {
  const task = defaultTask(template, CLOCK),
    candidate = sampleResults(task, CLOCK)[0];
  for (const f of candidate.facts) {
    f.priceBasis = f.unit === 'USD' ? 'all_in' : undefined;
    f.conditions = [];
    f.certainty = 'confirmed';
    if (f.unit === 'USD') {
      f.raw = `The firm all-in amount is $${Number(f.value) / 100}, including all mandatory charges and taxes.`;
      candidate.transcript[f.turn].text = f.raw;
    }
  }
  return { task, candidate };
}
function price(candidate: CandidateResult) {
  return candidate.facts.find((f) => f.field === 'budget')!;
}
function statement(candidate: CandidateResult, f: Fact, text: string) {
  f.raw = text;
  candidate.transcript[f.turn].text = text;
}
const cases: {
  name: string;
  expected: Scenario['expected'];
  change: (task: Task, candidate: CandidateResult) => void;
  split: Scenario['split'];
}[] = [
  { name: 'all-requirements-confirmed', expected: 'pass', split: 'development', change: () => {} },
  {
    name: 'different-exact-item',
    expected: 'fail',
    split: 'development',
    change: (t, c) => {
      const r = t.requirements.find((r) => r.kind === 'exact')!;
      const f = c.facts.find((f) => f.field === r.id)!;
      f.value = 'Different item or service';
      statement(c, f, 'We only provide a different item or service.');
    },
  },
  {
    name: 'missing-total',
    expected: 'unknown',
    split: 'development',
    change: (_t, c) => {
      c.facts = c.facts.filter((f) => f.field !== 'budget');
    },
  },
  {
    name: 'starting-estimate',
    expected: 'unknown',
    split: 'development',
    change: (_t, c) => {
      const f = price(c);
      f.priceBasis = 'estimate';
      statement(c, f, 'This is only a starting estimate; the total is not confirmed.');
    },
  },
  {
    name: 'over-budget',
    expected: 'fail',
    split: 'development',
    change: (t, c) => {
      const f = price(c);
      f.value = Number(t.requirements.find((r) => r.id === 'budget')!.value) + 100;
      statement(c, f, 'The firm all-in total is above your stated limit.');
    },
  },
  {
    name: 'unanswered-custom-condition',
    expected: 'unknown',
    split: 'development',
    change: (t) => {
      t.requirements.push({
        id: 'custom-storage',
        label: 'Storage',
        kind: 'boolean',
        value: true,
        unit: 'none',
        importance: 'must',
        question: 'Is secure storage available?',
      });
    },
  },
  {
    name: 'tentative-answer',
    expected: 'unknown',
    split: 'development',
    change: (_t, c) => {
      const f = price(c);
      f.certainty = 'tentative';
      statement(c, f, 'Probably, but I cannot confirm that price.');
    },
  },
  {
    name: 'touching-time-endpoints',
    expected: 'fail',
    split: 'development',
    change: (t, c) => {
      const r = t.requirements.find((r) => r.kind === 'window')!,
        f = c.facts.find((f) => f.field === r.id)!;
      if (typeof r.value === 'object')
        f.value = {
          start: new Date(Date.parse(r.value.start) - 3600000).toISOString(),
          end: r.value.start,
        };
    },
  },
  {
    name: 'expired-price',
    expected: 'unknown',
    split: 'development',
    change: (_t, c) => {
      price(c).expiresAt = '2026-09-08T15:00:00Z';
    },
  },
  {
    name: 'changed-request-scope',
    expected: 'unknown',
    split: 'development',
    change: (t) => {
      t.requirements.find((r) => r.kind === 'exact')!.value = 'A new exact request';
    },
  },
  {
    name: 'contradictory-totals',
    expected: 'unknown',
    split: 'held_out',
    change: (_t, c) => {
      const f = price(c),
        second = {
          ...f,
          id: `${f.id}-conflict`,
          value: Number(f.value) + 1,
          turn: c.transcript.length,
          raw: 'Actually the amount differs; no correction is established.',
        };
      c.transcript.push({ speaker: 'recipient', text: second.raw, offsetSeconds: 100 });
      c.facts.push(second);
    },
  },
  {
    name: 'explicit-price-correction',
    expected: 'pass',
    split: 'held_out',
    change: (t, c) => {
      const f = price(c);
      f.value = Number(t.requirements.find((r) => r.id === 'budget')!.value) + 100;
      const correction = {
        ...f,
        id: `${f.id}-correction`,
        supersedes: f.id,
        value: Number(t.requirements.find((r) => r.id === 'budget')!.value) - 100,
        turn: c.transcript.length,
        raw: 'I correct my earlier price. The new firm total is within your limit, including all fees and taxes.',
      };
      c.transcript.push({ speaker: 'recipient', text: correction.raw, offsetSeconds: 100 });
      c.facts.push(correction);
    },
  },
  {
    name: 'wrong-currency',
    expected: 'unknown',
    split: 'held_out',
    change: (_t, c) => {
      price(c).unit = 'CAD';
    },
  },
  {
    name: 'caller-only-quotation',
    expected: 'unknown',
    split: 'held_out',
    change: (_t, c) => {
      const f = price(c);
      c.transcript[f.turn].speaker = 'caller';
    },
  },
  {
    name: 'conditional-price',
    expected: 'unknown',
    split: 'held_out',
    change: (_t, c) => {
      price(c).conditions = ['Only if inspection confirms no additional work'];
    },
  },
];
export const corpus: Scenario[] = (['repair', 'rental', 'venue'] as const).flatMap((template) =>
  cases.map((spec) => {
    const { task, candidate } = base(template);
    spec.change(task, candidate);
    return {
      id: `${template}/${spec.name}`,
      split: spec.split,
      task,
      candidate,
      expected: spec.expected,
      critical: true,
    };
  }),
);
