import type { CandidateResult, Check, Evaluation, Fact, Task } from './model';
import { evaluateCandidate, validateTask } from './evaluator';
import { contactBoundary } from './conversation';

export interface LimitChange {
  field: string;
  label: string;
  from: number;
  to: number;
  facts: Fact[];
}
export interface WhatIfOption {
  candidateId: string;
  changes: LimitChange[];
}
export type QuestionAdvice =
  | {
      kind: 'ask';
      field: string;
      question: string;
      reason: string;
      remaining: number;
      decisive: boolean;
    }
  | { kind: 'review' | 'none'; reason: string };

/** Only limit changes supported by current reviewed evidence. No rewritten facts or scope. */
export function whatWouldWork(
  task: Task,
  candidate: CandidateResult,
  now = new Date(),
): WhatIfOption | null {
  const evaluation = evaluateCandidate(task, candidate, now);
  if (evaluation.verdict !== 'fail') return null;
  const changes: LimitChange[] = [];
  for (const check of evaluation.blockers) {
    const r = check.requirement;
    if (
      check.verdict !== 'fail' ||
      r.kind !== 'max' ||
      r.unit !== 'USD' ||
      !['budget', 'deposit', 'upfront'].includes(r.id) ||
      typeof r.value !== 'number' ||
      !check.facts.length ||
      check.facts.some(
        (f) =>
          f.priceBasis !== 'all_in' ||
          f.certainty !== 'confirmed' ||
          f.conditions.length ||
          typeof f.value !== 'number',
      )
    )
      return null;
    const amount =
      r.id === 'upfront'
        ? ['budget', 'deposit'].reduce(
            (sum, id) =>
              sum + Number(evaluation.checks.find((c) => c.requirement.id === id)?.facts[0]?.value),
            0,
          )
        : Number(check.facts[0].value);
    if (!Number.isSafeInteger(amount) || amount <= r.value) return null;
    changes.push({ field: r.id, label: r.label, from: r.value, to: amount, facts: check.facts });
  }
  if (!changes.length) return null;
  const option = { candidateId: candidate.id, changes };
  // Scope dependencies can make even a monetary change unsafe to reuse.
  return evaluateCandidate(taskWithLimits(task, option, {}), candidate, now).verdict === 'pass'
    ? option
    : null;
}

export function taskWithLimits(
  task: Task,
  option: WhatIfOption,
  values: Record<string, number>,
): Task {
  const next = structuredClone(task);
  for (const change of option.changes) {
    const r = next.requirements.find((r) => r.id === change.field);
    if (r) r.value = values[change.field] ?? change.to;
  }
  return next;
}

function awaitingReview(check: Check, candidate: CandidateResult) {
  return candidate.mode !== 'sample' && check.facts.some((f) => !f.reviewed && !f.rejected);
}

/** Explain a deterministic priority; this is not a prediction of the recipient's answer. */
export function nextUsefulQuestion(
  task: Task,
  candidate: CandidateResult,
  now = new Date(),
): QuestionAdvice {
  if (Object.keys(validateTask(task)).length)
    return { kind: 'review', reason: 'Complete your requirements before choosing a follow-up.' };
  if (candidate.disposition === 'refused')
    return {
      kind: 'none',
      reason: 'The recipient declined. Respect that response; no follow-up is suggested.',
    };
  if (
    candidate.disposition === 'no_answer' ||
    candidate.disposition === 'voicemail' ||
    candidate.disposition === 'uncontacted'
  )
    return {
      kind: 'none',
      reason: 'There is no answered conversation to clarify. No repeat call is suggested.',
    };
  if (candidate.disposition === 'invalid_output')
    return {
      kind: 'review',
      reason: 'Review the returned conversation before deciding whether another inquiry is useful.',
    };
  const contact = contactBoundary(candidate);
  if (contact) return { kind: 'review', reason: contact };
  const evaluation = evaluateCandidate(task, candidate, now);
  if (evaluation.verdict === 'pass')
    return {
      kind: 'none',
      reason: 'This option already meets your checked requirements. No further question is needed.',
    };
  const failed = evaluation.blockers.find((c) => c.verdict === 'fail');
  if (failed)
    return {
      kind: 'none',
      reason: `${failed.requirement.label} already fails a must-have. Another answer cannot make this option fit your current requirements.`,
    };
  if (evaluation.blockers.some((c) => awaitingReview(c, candidate)))
    return {
      kind: 'review',
      reason: 'Review the extracted facts first. The answer may already be in the conversation.',
    };
  if (!candidate.facts.some((f) => !f.rejected))
    return {
      kind: 'review',
      reason:
        'No usable factual answer was captured. Review the conversation before considering another call.',
    };
  if (evaluation.blockers.some((c) => c.requirement.kind === 'manual'))
    return {
      kind: 'review',
      reason:
        'A must-have needs your judgment. Another automated question cannot decide it for you.',
    };
  const questions = evaluation.blockers.filter((c) => c.requirement.id !== 'upfront');
  if (!questions.length)
    return {
      kind: 'review',
      reason: 'Review the price and deposit evidence before another inquiry.',
    };
  const rank = (c: Check) =>
    ['service', 'item'].includes(c.requirement.id)
      ? 0
      : c.verdict === 'conflict'
        ? 1
        : c.requirement.unit === 'USD'
          ? 2
          : ['deadline', 'window'].includes(c.requirement.kind)
            ? 3
            : 4;
  const chosen = [...questions].sort((a, b) => rank(a) - rank(b))[0];
  if (
    chosen.facts.some((f) =>
      /\b(?:don['’]?t know|do not know|not sure|can['’]?t answer)\b/i.test(f.raw),
    )
  )
    return {
      kind: 'review',
      reason:
        'The recipient already expressed uncertainty. Review that answer instead of repeating the question.',
    };
  const decisive = questions.length === 1;
  return {
    kind: 'ask',
    field: chosen.requirement.id,
    question: chosen.requirement.question,
    remaining: questions.length,
    decisive,
    reason: decisive
      ? 'This is the only factual question left for the must-haves. A supported answer could change the decision; an unknown answer leaves it unresolved.'
      : ['service', 'item'].includes(chosen.requirement.id)
        ? 'Confirm the basic fit before spending time on price or availability.'
        : chosen.verdict === 'conflict'
          ? 'Resolve the contradictory answer before relying on this option.'
          : `Start with ${chosen.requirement.label.toLowerCase()}. ${questions.length} factual questions still affect the must-haves.`,
  };
}

export function bestNextQuestion(task: Task, results: CandidateResult[], now = new Date()) {
  if (results.some((c) => evaluateCandidate(task, c, now).verdict === 'pass')) return null;
  return (
    results
      .map((candidate) => ({ candidate, advice: nextUsefulQuestion(task, candidate, now) }))
      .filter(
        (
          entry,
        ): entry is {
          candidate: CandidateResult;
          advice: Extract<QuestionAdvice, { kind: 'ask' }>;
        } => entry.advice.kind === 'ask',
      )
      .sort(
        (a, b) =>
          a.advice.remaining - b.advice.remaining ||
          a.candidate.name.localeCompare(b.candidate.name),
      )[0] ?? null
  );
}

export function previewLimits(
  task: Task,
  candidate: CandidateResult,
  option: WhatIfOption,
  values: Record<string, number>,
  now = new Date(),
): { task: Task; evaluation: Evaluation; valid: boolean } {
  const next = taskWithLimits(task, option, values);
  const valid =
    option.candidateId === candidate.id &&
    option.changes.length > 0 &&
    option.changes.every((change) => {
      const amount = values[change.field] ?? change.to;
      return Number.isSafeInteger(amount) && amount >= change.from;
    }) &&
    !Object.keys(validateTask(next)).length;
  return { task: next, evaluation: evaluateCandidate(next, candidate, now), valid };
}
