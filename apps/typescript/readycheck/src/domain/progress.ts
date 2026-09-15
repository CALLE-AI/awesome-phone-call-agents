import type { CandidateResult, CaseRecord, Inquiry, Plan } from './model';
import { evaluateCandidate } from './evaluator';

export type CheckPhase =
  'ready' | 'calling' | 'review' | 'decision' | 'completed' | 'stopped' | 'attention';
export interface CheckProgress {
  phase: CheckPhase;
  step: number;
  label: string;
  headline: string;
  detail: string;
  action: 'options' | 'evidence' | 'activity';
  actionLabel: string;
  candidateId?: string;
  pendingAnswers: number;
}
export function pendingFacts(result: CandidateResult) {
  return result.facts.filter(
    (fact) =>
      !fact.reviewed &&
      !fact.rejected &&
      !result.facts.some(
        (newer) => newer.supersedes === fact.id && newer.reviewed && !newer.rejected,
      ),
  );
}
export const inquiryLabels: Record<Inquiry['state'], string> = {
  queued: 'Waiting to start',
  claimed: 'Sending your inquiry',
  dispatch_unknown: 'Call status needs checking',
  submitted: 'Waiting for CALL-E',
  observing: 'Waiting for the call result',
  review_required: 'Ready for your review',
  evaluated: 'Review complete',
  failed: 'Inquiry could not finish',
  stopped: 'Not being called',
};

export function checkProgress(
  record: CaseRecord,
  plans: Plan[] = [],
  now = new Date(),
  version = record.currentVersion,
): CheckProgress {
  const revision = record.revisions.find((r) => r.version === version)!;
  const inquiries = plans.filter((p) => p.version === version).flatMap((p) => p.inquiries);
  const pending = revision.results.filter((r) => r.mode === 'live').flatMap((r) => pendingFacts(r));
  const base = { pendingAnswers: pending.length };
  if (inquiries.some((i) => i.state === 'dispatch_unknown'))
    return {
      ...base,
      phase: 'attention',
      step: 1,
      label: 'Needs attention',
      headline: 'Your call needs recovery.',
      detail:
        'The call may have started. Your sequence is paused so this app does not send it again.',
      action: 'activity',
      actionLabel: 'View call status',
    };
  if (inquiries.some((i) => ['claimed', 'submitted', 'observing'].includes(i.state)))
    return {
      ...base,
      phase: 'calling',
      step: 1,
      label: 'Inquiry in progress',
      headline: 'Your inquiry is in progress.',
      detail:
        'Waiting for CALL-E to return the conversation and answers. This page updates automatically.',
      action: 'activity',
      actionLabel: 'View call status',
    };
  const review = revision.results.find(
    (r) =>
      r.mode === 'live' &&
      (pendingFacts(r).length ||
        inquiries.some((i) => i.id === r.inquiryId && i.state === 'review_required')),
  );
  if (review)
    return {
      ...base,
      phase: 'review',
      step: 2,
      label: 'Review answers',
      headline: pending.length
        ? `${pending.length} answer${pending.length === 1 ? '' : 's'} ready for your review.`
        : 'Your call result is ready.',
      detail:
        'Check the recipient’s words and any corrected interpretations before using the result.',
      action: 'evidence',
      actionLabel: 'Review the answers',
      candidateId: review.id,
    };
  const outcomes = record.outcomes.filter(
    (o) =>
      Date.parse(o.at) >= Date.parse(revision.createdAt) &&
      revision.results.some((r) => r.id === o.candidateId),
  );
  const latest = new Map(outcomes.map((o) => [o.candidateId, o]));
  const complete = [...latest.values()].find((o) => o.state === 'completed');
  if (complete)
    return {
      ...base,
      phase: 'completed',
      step: 4,
      label: 'Completed by you',
      headline: 'You’ve marked this task complete.',
      detail: 'Your requirements, source evidence and outcome are saved together for reference.',
      action: 'activity',
      actionLabel: 'View your outcome',
    };
  if (record.stopped)
    return {
      ...base,
      phase: 'stopped',
      step: 3,
      label: 'Calls stopped',
      headline: 'Future calls are stopped.',
      detail:
        'Your saved evidence is still here. You can review the results and record what happened.',
      action: 'activity',
      actionLabel: 'View activity',
    };
  if (revision.results.length) {
    const matches = revision.results.filter(
      (r) => evaluateCandidate(revision.task, r, now).verdict === 'pass',
    ).length;
    const selected = [...latest.values()].some((o) =>
      ['selected', 'arrangement_confirmed'].includes(o.state),
    );
    return {
      ...base,
      phase: 'decision',
      step: 3,
      label: selected ? 'Next step saved' : matches ? 'Options ready' : 'Compare answers',
      headline: selected
        ? 'Your next step is saved.'
        : matches
          ? 'You have an option that fits.'
          : 'Let’s find your next useful step.',
      detail: selected
        ? 'Record an arrangement or completion when it happens. Your shortlist does not make a booking.'
        : matches
          ? 'Inspect the supporting evidence, then choose which option to pursue.'
          : 'Compare the blockers, resolve a missing answer, or explore a supported change to your budget.',
      action: 'options',
      actionLabel: selected ? 'Continue your check' : 'Compare the options',
    };
  }
  if (inquiries.some((i) => i.state === 'failed'))
    return {
      ...base,
      phase: 'attention',
      step: 1,
      label: 'Needs attention',
      headline: 'This inquiry could not finish.',
      detail: 'Open the call status to see what happened before deciding what to do next.',
      action: 'activity',
      actionLabel: 'View call status',
    };
  return {
    ...base,
    phase: 'ready',
    step: 1,
    label: 'Ready to check',
    headline: 'Your request is ready. Choose who to ask.',
    detail:
      record.mode === 'sample'
        ? 'Try the complete workflow with fictional businesses. You’ll preview the questions before loading their answers.'
        : 'Choose an approved recipient and review the questions before the call begins.',
    action: 'options',
    actionLabel: 'Choose your options',
  };
}
