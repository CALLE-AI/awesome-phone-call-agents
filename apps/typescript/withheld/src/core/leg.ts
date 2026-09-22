/**
 * One leg of an errand.
 *
 * A leg is a single outbound call plus the verdict drawn from it. Verdicts are
 * only ever drawn from terminal provider statuses — a call still `queued` or
 * `in_progress` gets no verdict, no window, and no privacy finding, because
 * there is nothing yet to be right or wrong about.
 */

import {
  refusesCall,
  scanAgainstBudget,
  scanForNumbers,
  scanForProhibited,
  containsNumber,
} from './budget';
import {
  detectCallbackOffer,
  detectNumberRequest,
  detectScheduleRefusal,
  extractWindow,
} from './callback';
import { bindAnswers, disclosedFromBudget, type ProviderClaim } from './transcript';
import {
  isTerminal,
  type CallStatus,
  type ErrandFile,
  type Finding,
  type LegResult,
  type LegStatus,
  type NextAction,
  type Turn,
} from './types';

export interface LegInput {
  errand: ErrandFile;
  leg: number;
  status: CallStatus;
  turns: Turn[];
  providerClaims?: ProviderClaim[];
  transcriptRef: string;
  now: Date;
}

const EMPTY_WINDOW = { start: null, end: null, supporting_turn: null };

function emptyResult(
  input: LegInput,
  status: LegStatus,
  nextAction: NextAction,
): LegResult {
  return {
    errand_id: input.errand.errand_id,
    leg: input.leg,
    status,
    answers: [],
    callback_requested_by_callee: false,
    number_requested_by_callee: false,
    number_disclosed: false,
    agreed_window: EMPTY_WINDOW,
    disclosed_about_person: [],
    outside_may_say_findings: [],
    next_action: nextAction,
    transcript_ref: input.transcriptRef,
  };
}

export function runLeg(input: LegInput): LegResult {
  const { errand, turns, now } = input;

  // 1. Terminal statuses only.
  if (!isTerminal(input.status)) {
    return emptyResult(input, 'not_terminal', 'needs_human');
  }

  if (input.status === 'no_answer' || input.status === 'busy') {
    return emptyResult(input, 'no_answer', 'needs_human');
  }

  if (input.status === 'failed' || input.status === 'canceled') {
    return emptyResult(input, 'outcome_unknown', 'needs_human');
  }

  // A completed call with nothing readable is unknown, never "nothing was said".
  if (turns.length === 0) {
    return emptyResult(input, 'outcome_unknown', 'needs_human');
  }

  const callerSpeech = turns
    .filter((t) => t.speaker === 'caller')
    .map((t) => t.text)
    .join('\n');

  // Turns CALL-E could not attribute. These cannot confirm anything — no window
  // is agreed on an unattributed turn, no answer is bound to one — but they are
  // still scanned, because a number audible on the line was disclosed whoever
  // said it. Findings from here are labelled so the report never claims the
  // agent said something it may not have.
  const unattributedSpeech = turns
    .filter((t) => t.speaker === 'unknown')
    .map((t) => t.text)
    .join('\n');

  // 2. What did the caller actually say about the person?
  const violations: Finding[] = [
    ...scanForNumbers({
      text: callerSpeech,
      personPhone: errand.person.phone,
      where: 'caller_speech',
    }),
    ...scanForProhibited(callerSpeech, 'caller_speech'),
    ...scanAgainstBudget(callerSpeech, errand.may_say, 'caller_speech'),
    ...scanForNumbers({
      text: unattributedSpeech,
      personPhone: errand.person.phone,
      where: 'unattributed_speech',
    }),
    ...scanForProhibited(unattributedSpeech, 'unattributed_speech'),
  ];

  const numberDisclosed =
    containsNumber(callerSpeech, errand.person.phone) ||
    containsNumber(unattributedSpeech, errand.person.phone);

  // 3. Evidence-bound answers.
  const answers = bindAnswers(errand.questions, turns, input.providerClaims);
  const disclosed = disclosedFromBudget(turns, errand.may_say);

  // 4. The callback gate.
  const offer = detectCallbackOffer(turns);
  const numberRequest = detectNumberRequest(turns);
  const parsed = extractWindow(turns, now);

  const base: LegResult = {
    errand_id: errand.errand_id,
    leg: input.leg,
    status: 'errand_complete',
    answers,
    callback_requested_by_callee: offer.matched,
    number_requested_by_callee: numberRequest.matched,
    number_disclosed: numberDisclosed,
    agreed_window: parsed.window,
    disclosed_about_person: disclosed,
    outside_may_say_findings: violations,
    next_action: 'errand_complete',
    transcript_ref: input.transcriptRef,
  };

  // 5. A leaked number is the one failure this app exists to prevent. It
  //    outranks every other outcome, including a successfully booked errand.
  if (numberDisclosed || refusesCall(violations)) {
    return { ...base, status: 'outcome_unknown', next_action: 'needs_human' };
  }

  // 6. Outcome. A confirmed window advances the chain; everything else is
  //    ranked by why the errand could not advance.
  const allAnswered =
    answers.length > 0 && answers.every((a) => a.supporting_turn !== null);
  const refusal = detectScheduleRefusal(turns, Math.max(offer.index, 0));

  if (parsed.confirmed) {
    return { ...base, status: 'window_agreed', next_action: 'schedule_next_leg' };
  }

  if (!offer.matched && allAnswered) {
    return { ...base, status: 'errand_complete', next_action: 'errand_complete' };
  }

  if (offer.matched && refusal.matched) {
    return {
      ...base,
      status: 'callback_refused_by_callee',
      next_action: 'needs_human',
    };
  }

  // The callee wanted a number and the caller held the line. Holding the line
  // is the success; the errand still stalled, so a human picks it up.
  if (numberRequest.matched) {
    return { ...base, status: 'number_demanded', next_action: 'needs_human' };
  }

  return { ...base, status: 'window_unconfirmed', next_action: 'needs_human' };
}
