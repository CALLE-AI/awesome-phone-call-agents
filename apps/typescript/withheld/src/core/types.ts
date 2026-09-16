/**
 * Core domain types for Withheld.
 *
 * The unit of work is an *errand*: a goal that takes one or more phone calls to
 * finish. Each call is a *leg*. A leg never ends by handing over the person's
 * number — it ends either with the errand done, or with a time window the next
 * leg is scheduled into.
 */

/**
 * CALL-E labels transcript turns `bot`, `user`, or `unknown`. The third label
 * is not noise and is not roundable to either side: diarisation genuinely fails
 * sometimes. An unattributed turn can never confirm anything — but it can still
 * convict, because a number spoken by nobody-in-particular was still spoken on
 * an open line.
 */
export type Speaker = 'caller' | 'callee' | 'unknown';

export interface Turn {
  speaker: Speaker;
  text: string;
  /** Offset in seconds from call start, when the provider supplies it. */
  at?: number;
}

export interface Question {
  id: string;
  /** The question as the caller should ask it. */
  ask: string;
}

export interface TimeWindow {
  start: string;
  end: string;
}

/**
 * The leg's disposition, as this app understands it.
 *
 * This is a *derived* status, not CALL-E's. The API reports a call task as
 * `queued | in_progress | completed | failed | canceled` — there is no
 * call-level "nobody picked up", because a task can have several recipients and
 * several attempts. A no-answer only exists one level down, in the attempt's
 * status and failure code, and the adapter is what folds it up to here.
 *
 * Verdicts are only ever drawn from terminal statuses; `queued` and
 * `in_progress` yield no result at all.
 */
export type CallStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'no_answer'
  | 'busy'
  | 'canceled'
  | 'failed';

export const TERMINAL_STATUSES: readonly CallStatus[] = [
  'completed',
  'no_answer',
  'busy',
  'canceled',
  'failed',
] as const;

export function isTerminal(status: CallStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface Person {
  name: string;
  /** Never disclosed. Present so the app can prove it never said it. */
  phone: string;
}

export interface Callee {
  name: string;
  phone: string;
}

export interface ErrandFile {
  errand_id: string;
  person: Person;
  callee: Callee;
  /** Why the person delegated this. Stays local; never sent to the provider. */
  reason: string;
  /** What the caller is trying to achieve, in one line. Sent to the provider. */
  goal: string;
  questions: Question[];
  /**
   * The exact facts that may be spoken aloud. Anything about the person that is
   * not in this list must not reach the script or the call.
   */
  may_say: string[];
  /** Windows in which the person will accept an arrangement. */
  acceptable_windows: TimeWindow[];
  /** Extra items barred regardless of anything else in the file. */
  never_disclose?: string[];
}

export type FindingKind =
  | 'phone_number'
  | 'payment_card'
  | 'national_id'
  | 'password'
  | 'outside_may_say';

export interface Finding {
  kind: FindingKind;
  /** Always masked. A privacy report that quotes the leak is not a report. */
  masked: string;
  where: 'errand_file' | 'script' | 'caller_speech' | 'unattributed_speech';
  note: string;
}

export interface BoundAnswer {
  question_id: string;
  question: string;
  answer: string | null;
  /** The callee turn that supports this answer. Null means unsupported. */
  supporting_turn: string | null;
  /** Set when the provider claimed an answer nothing in the transcript supports. */
  provider_claimed_unsupported: boolean;
}

export type LegStatus =
  | 'errand_complete'
  | 'window_agreed'
  | 'window_unconfirmed'
  | 'callback_refused_by_callee'
  | 'number_demanded'
  | 'outcome_unknown'
  | 'no_answer'
  | 'not_terminal';

export type NextAction =
  | 'errand_complete'
  | 'schedule_next_leg'
  | 'needs_human';

export interface AgreedWindow {
  start: string | null;
  end: string | null;
  supporting_turn: string | null;
}

export interface LegResult {
  errand_id: string;
  leg: number;
  status: LegStatus;
  answers: BoundAnswer[];
  callback_requested_by_callee: boolean;
  number_requested_by_callee: boolean;
  /** The invariant this whole app exists to hold. */
  number_disclosed: boolean;
  agreed_window: AgreedWindow;
  disclosed_about_person: string[];
  outside_may_say_findings: Finding[];
  next_action: NextAction;
  transcript_ref: string;
}
