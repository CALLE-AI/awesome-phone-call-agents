import { explicitDollars } from './money';
import {
  EVALUATOR_VERSION,
  type CandidateResult,
  type Check,
  type Evaluation,
  type Fact,
  type Requirement,
  type Task,
  type Value,
} from './model';
import { formatTime, isTimeZone } from './time';

const normal = (v: Value) =>
  typeof v === 'string'
    ? v.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
    : JSON.stringify(v);
export const acceptsExact = (r: Requirement, value: Value) =>
  [r.value, ...(r.alternatives || [])].some((allowed) => normal(allowed) === normal(value));
const instant = (v: unknown) =>
  typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
export function validateTask(task: Task): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!task.title.trim()) errors.title = 'Give this task a name.';
  if (!task.locality.trim()) errors.locality = 'Enter a city or locality.';
  if (!isTimeZone(task.timeZone)) errors.timeZone = 'Choose a valid IANA time zone.';
  const requiredIds = {
    repair: ['service', 'budget', 'deadline', 'dropoff'],
    rental:
      task.acquisition === 'purchase'
        ? ['item', 'quantity', 'period', 'budget', 'hdmi']
        : ['item', 'quantity', 'period', 'budget', 'deposit', 'hdmi'],
    venue: ['service', 'capacity', 'period', 'budget', 'access'],
  }[task.template];
  for (const id of requiredIds)
    if (!task.requirements.some((r) => r.id === id))
      errors[id] = 'A required template field is missing.';
  if (!task.requirements.some((r) => r.importance === 'must'))
    errors.requirements = 'Keep at least one must-have requirement.';
  const seen = new Set<string>();
  for (const r of task.requirements) {
    if (
      r.alternatives?.length &&
      (r.alternatives.some((v) => !v.trim()) ||
        r.kind !== 'exact' ||
        r.id !== 'item' ||
        new Set([r.value, ...r.alternatives].map(normal)).size !== r.alternatives.length + 1)
    )
      errors[r.id] = 'List up to three distinct alternatives for the exact item only.';
    if (seen.has(r.id)) errors[r.id] = 'Requirement identifiers must be unique.';
    seen.add(r.id);
    if (['budget', 'deposit', 'upfront'].includes(r.id) && (r.unit !== 'USD' || r.kind !== 'max'))
      errors[r.id] = 'Money limits must be expressed as a USD maximum.';
    if (
      r.id.startsWith('custom') &&
      r.question === 'Please describe the specific yes/no question to ask.'
    )
      errors[r.id] = 'Write the specific question for this custom requirement.';
    if (
      (r.kind === 'exact' || r.kind === 'manual') &&
      (typeof r.value !== 'string' || !r.value.trim())
    )
      errors[r.id] = 'Enter what must be checked.';
    if (r.kind === 'boolean' && typeof r.value !== 'boolean') errors[r.id] = 'Choose yes or no.';
    if (
      ['max', 'min'].includes(r.kind) &&
      (typeof r.value !== 'number' || !Number.isSafeInteger(r.value) || r.value < 0)
    )
      errors[r.id] = 'Enter a nonnegative whole amount (money uses cents).';
    if (r.kind === 'deadline' && !Number.isFinite(instant(r.value)))
      errors[r.id] = 'Enter a valid date, time, and time zone.';
    if (r.kind === 'window') {
      const v = r.value;
      if (
        typeof v !== 'object' ||
        !Number.isFinite(instant(v.start)) ||
        !Number.isFinite(instant(v.end)) ||
        instant(v.end) <= instant(v.start) ||
        (v.minimumMinutes ?? 1) * 60000 > instant(v.end) - instant(v.start)
      )
        errors[r.id] = 'End must be after start with enough usable time.';
    }
  }
  if (task.acquisition && task.template !== 'rental')
    errors.acquisition = 'Purchase or rental applies only to item checks.';
  if (
    task.acquisition === 'purchase' &&
    task.requirements.some((r) => ['deposit', 'upfront'].includes(r.id))
  )
    errors.acquisition = 'Purchase checks cannot reuse rental deposit requirements.';
  return errors;
}
export function displayValue(r: Requirement, zone = 'America/Chicago', showLimit = true): string {
  const v = r.value;
  if (r.unit === 'USD' && typeof v === 'number')
    return `${showLimit && r.kind === 'max' ? 'Up to ' : ''}${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: v % 100 ? 2 : 0 }).format(v / 100)}`;
  if (typeof v === 'boolean') return v ? 'Required' : 'Not wanted';
  if (r.kind === 'deadline' && typeof v === 'string') return formatTime(v, zone);
  if (typeof v === 'object') return `${formatTime(v.start, zone)} – ${formatTime(v.end, zone)}`;
  return r.alternatives?.length
    ? `${String(v)}; also accepted: ${r.alternatives.join(', ')}`
    : String(v);
}
function compare(r: Requirement, f: Fact): { verdict: Check['verdict']; reason: string } {
  const unknown = (reason: string) => ({ verdict: 'unknown' as const, reason });
  if (f.certainty !== 'confirmed')
    return unknown('The answer is tentative; confirmation is still needed.');
  if (f.conditions.length) return unknown(`Conditional answer: ${f.conditions.join('; ')}`);
  if (f.answerState === 'unknown') return unknown('The recipient did not establish an answer.');
  if (r.kind === 'manual')
    return unknown(
      'This custom condition requires human judgment; automatic matching is unavailable.',
    );
  if (
    f.answerState === 'unavailable' ||
    (f.value === false && ['window', 'deadline', 'exact'].includes(r.kind))
  )
    return {
      verdict: 'fail',
      reason: 'The recipient confirmed that the requested requirement cannot be met.',
    };
  if (r.unit !== 'none' && f.unit !== r.unit)
    return unknown('The unit or currency is missing or does not match.');
  let passed: boolean;
  if (r.kind === 'exact') {
    if (typeof f.value !== 'string' || typeof r.value !== 'string')
      return unknown('The exact identity was not supplied in a valid format.');
    passed = acceptsExact(r, f.value);
    if (passed && normal(f.value) !== normal(r.value))
      return {
        verdict: 'pass',
        reason: `The recipient confirmed an alternative you explicitly accepted: ${f.value}.`,
      };
  } else if (r.kind === 'boolean') {
    if (typeof f.value !== 'boolean') return unknown('A clear yes or no was not established.');
    passed = f.value === r.value;
  } else if (r.kind === 'max' || r.kind === 'min') {
    if (
      typeof f.value !== 'number' ||
      !Number.isSafeInteger(f.value) ||
      f.value < 0 ||
      typeof r.value !== 'number'
    )
      return unknown('A valid amount was not established.');
    if (r.unit === 'USD' && f.priceBasis !== 'all_in') {
      if (r.kind === 'max' && f.priceBasis === 'minimum' && f.value > r.value)
        return { verdict: 'fail', reason: 'The confirmed minimum already exceeds your limit.' };
      return unknown(
        'The all-in amount is not confirmed. A starting estimate cannot satisfy a hard budget.',
      );
    }
    passed = r.kind === 'max' ? f.value <= r.value : f.value >= r.value;
  } else if (r.kind === 'deadline') {
    if (!Number.isFinite(instant(f.value)) || !Number.isFinite(instant(r.value)))
      return unknown('The completion date or time is missing.');
    passed = instant(f.value) <= instant(r.value);
  } else {
    if (typeof f.value !== 'object' || typeof r.value !== 'object')
      return unknown('The usable time window is missing.');
    const times = [
      instant(f.value.start),
      instant(f.value.end),
      instant(r.value.start),
      instant(r.value.end),
    ];
    if (times.some((t) => !Number.isFinite(t)) || times[1] <= times[0])
      return unknown('The returned time window is invalid.');
    const overlap = Math.min(times[1], times[3]) - Math.max(times[0], times[2]);
    passed =
      overlap > 0 &&
      overlap >= Math.max(r.value.minimumMinutes ?? 1, f.value.minimumMinutes ?? 1) * 60000;
  }
  return {
    verdict: passed ? 'pass' : 'fail',
    reason: passed
      ? 'Current evidence supports this requirement.'
      : r.kind === 'window'
        ? 'There is not enough usable overlap with your requested window.'
        : r.kind === 'exact'
          ? 'The confirmed item or service differs from your exact request.'
          : 'The confirmed answer does not meet your requirement.',
  };
}
export function evaluateCandidate(
  task: Task,
  candidate: CandidateResult,
  now = new Date(),
): Evaluation {
  const errors = validateTask(task);
  const item = task.requirements.find((r) => r.id === 'item');
  const offeredItems = [
    ...new Set(
      candidate.facts
        .filter((f) => f.field === 'item' && !f.rejected && f.certainty === 'confirmed')
        .map((f) => normal(f.value)),
    ),
  ];
  const checks = task.requirements.map((r): Check => {
    const base = { requirement: r, facts: [] as Fact[], question: r.question };
    if (Object.keys(errors).length)
      return {
        ...base,
        verdict: 'unknown',
        reason: 'Complete the required task fields before comparing.',
      };
    if (candidate.disposition !== 'answered')
      return {
        ...base,
        verdict: 'unknown',
        reason: {
          no_answer: 'No answer. This is not a confirmed negative.',
          voicemail: 'Reached voicemail; this requirement is unanswered.',
          refused: 'The recipient declined the inquiry.',
          invalid_output: 'The returned result could not be validated.',
          uncontacted: 'This candidate has not been contacted.',
        }[candidate.disposition],
      };
    const raw = candidate.facts.filter((f) => f.field === r.id && !f.rejected);
    const applicable = raw.filter((f) => {
      if (
        task.template === 'rental' &&
        (f.scope.$acquisition ?? 'rental') !== (task.acquisition ?? 'rental')
      )
        return false;
      return Object.entries(f.scope).every(([id, value]) => {
        if (id === '$acquisition') return true;
        if (id === 'item' && r.id !== 'item' && item)
          return (
            offeredItems.length === 1 &&
            normal(value) === offeredItems[0] &&
            acceptsExact(item, value)
          );
        return normal(task.requirements.find((x) => x.id === id)?.value ?? '') === normal(value);
      });
    });
    if (!applicable.length)
      return {
        ...base,
        verdict: 'unknown',
        reason: raw.length
          ? 'The request changed; this evidence does not establish the new conditions.'
          : 'This requirement was not answered.',
      };
    const supported = applicable.filter((f) => {
      const transcript =
        f.sourceId === candidate.sourceId ? candidate.transcript : candidate.sources?.[f.sourceId];
      return (
        f.speaker === 'recipient' &&
        transcript?.[f.turn]?.speaker === 'recipient' &&
        f.raw.length > 0 &&
        transcript[f.turn].text.includes(f.raw)
      );
    });
    if (!supported.length)
      return {
        ...base,
        facts: applicable,
        verdict: 'unknown',
        reason: 'No supporting recipient statement could be verified in the source.',
      };
    const reviewed = supported.filter((f) => candidate.mode === 'sample' || f.reviewed);
    if (!reviewed.length)
      return {
        ...base,
        facts: supported,
        verdict: 'unknown',
        reason: 'Review the extracted material fact against its source before using it.',
      };
    const superseded = new Set(reviewed.map((f) => f.supersedes).filter(Boolean));
    const active = reviewed.filter((f) => !superseded.has(f.id));
    const current = active.filter(
      (f) =>
        Number.isFinite(Date.parse(f.observedAt)) &&
        Date.parse(f.observedAt) <= now.getTime() + 60000 &&
        Date.parse(f.expiresAt) > now.getTime(),
    );
    if (!current.length)
      return {
        ...base,
        facts: active,
        verdict: 'stale',
        reason:
          'This evidence is expired or has an invalid timestamp. Recheck before relying on it.',
      };
    if (
      new Set(
        current.map((f) =>
          JSON.stringify([
            normal(f.value),
            f.priceBasis,
            f.conditions,
            f.certainty,
            f.answerState ?? 'value',
          ]),
        ),
      ).size > 1
    )
      return {
        ...base,
        facts: current,
        verdict: 'conflict',
        reason: 'The source contains conflicting answers without an explicit correction.',
      };
    const quotedCents = r.unit === 'USD' ? explicitDollars(current[0].raw) : null;
    if (quotedCents !== null && quotedCents !== current[0].value)
      return {
        ...base,
        facts: current,
        verdict: 'unknown',
        reason:
          'The normalized amount contradicts the explicit dollar quote. Correct the interpretation before relying on it.',
      };
    const decision = compare(r, current[0]);
    return {
      ...base,
      facts: current,
      ...decision,
      question: decision.verdict === 'pass' ? undefined : r.question,
    };
  });
  const upfront = checks.find((c) => c.requirement.id === 'upfront');
  if (upfront && task.template === 'rental' && !Object.keys(errors).length) {
    const parts = ['budget', 'deposit'].map((id) => checks.find((c) => c.requirement.id === id));
    if (
      parts.every(
        (c) =>
          c &&
          ['pass', 'fail'].includes(c.verdict) &&
          c.facts[0]?.priceBasis === 'all_in' &&
          typeof c.facts[0].value === 'number',
      )
    ) {
      const amount = parts.reduce((sum, c) => sum + Number(c!.facts[0].value), 0);
      upfront.facts = parts.flatMap((c) => c!.facts);
      upfront.verdict = amount <= Number(upfront.requirement.value) ? 'pass' : 'fail';
      upfront.reason = `Up-front cash is $${(amount / 100).toFixed(2)}: confirmed rental cost plus the separately refundable deposit. The deposit is not included in the final nonrefundable cost.`;
    } else {
      upfront.verdict = 'unknown';
      upfront.reason =
        'Confirm both the all-in rental fee and the refundable deposit before comparing up-front cash.';
    }
  }
  const blockers = checks.filter(
    (c) => c.requirement.importance === 'must' && c.verdict !== 'pass',
  );
  const verdict = blockers.some((c) => c.verdict === 'fail')
    ? 'fail'
    : blockers.length
      ? 'unknown'
      : 'pass';
  return {
    candidateId: candidate.id,
    verdict,
    label:
      verdict === 'pass'
        ? 'Meets checked requirements'
        : verdict === 'fail'
          ? 'Does not meet requirements'
          : 'Needs clarification',
    checks,
    blockers,
    preferencePasses: checks.filter(
      (c) => c.requirement.importance === 'preference' && c.verdict === 'pass',
    ).length,
    evaluatedAt: now.toISOString(),
    evaluatorVersion: EVALUATOR_VERSION,
  };
}
export function rankResults(task: Task, results: CandidateResult[], now = new Date()) {
  const order = { pass: 0, unknown: 1, fail: 2 };
  return results
    .map((candidate) => ({ candidate, evaluation: evaluateCandidate(task, candidate, now) }))
    .sort(
      (a, b) =>
        order[a.evaluation.verdict] - order[b.evaluation.verdict] ||
        b.evaluation.preferencePasses - a.evaluation.preferencePasses ||
        Date.parse(b.candidate.checkedAt) - Date.parse(a.candidate.checkedAt) ||
        a.candidate.name.localeCompare(b.candidate.name),
    );
}
