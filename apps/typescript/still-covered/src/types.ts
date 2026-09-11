// Still Covered domain vocabulary.
//
// Every answer a conversation is reduced to is a closed, enumerated value. The voice agent fills
// them in; Still Covered's pure functions decide what happens next. Nothing here changes anyone's
// coverage: the output is a worklist that a caseworker or navigator acts on.

export type YesNoUnknown = "yes" | "no" | "unknown";

/** An answer to a screening question. not_asked is distinct from unknown on purpose. */
export type Answer = "yes" | "no" | "unknown" | "not_asked";

export type ExemptionCode =
  | "caregiver_child"
  | "pregnant_postpartum"
  | "caregiver_disabled"
  | "medically_frail"
  | "snap_tanf"
  | "veteran_disability"
  | "sud_treatment"
  | "former_foster_youth"
  | "tribal";

export const EXEMPTION_CODES: readonly ExemptionCode[] = [
  "caregiver_child",
  "pregnant_postpartum",
  "caregiver_disabled",
  "medically_frail",
  "snap_tanf",
  "veteran_disability",
  "sud_treatment",
  "former_foster_youth",
  "tribal",
];

/** Exemptions that may be asked about on a call. Tribal status comes from state records only. */
export const ASKABLE_CODES = [
  "caregiver_child",
  "pregnant_postpartum",
  "caregiver_disabled",
  "medically_frail",
  "snap_tanf",
  "veteran_disability",
  "sud_treatment",
  "former_foster_youth",
] as const;

export type AskableCode = (typeof ASKABLE_CODES)[number];

/** One enrollee on the outreach list. Phone numbers are E.164 and validated on load. */
export interface Enrollee {
  id: string;
  name: string;
  firstName: string;
  phone: string;
  /** BCP 47 locale hint for CALL-E, e.g. "en-US", "es-US". */
  locale: string;
  /** ISO country code used by CALL-E for routing, e.g. "US". */
  region: string;
  /** Used only to confirm identity before anything about coverage is said. */
  birthYear: number | null;
  /** When the state first checks this person's compliance (YYYY-MM-DD), e.g. their first renewal in 2027. */
  checkDate: string | null;
  /** What the state's own records already show, per exemption. */
  known: Partial<Record<ExemptionCode, YesNoUnknown>>;
  /** State wage or income data already shows the requirement is met. */
  knownCompliant: YesNoUnknown;
  hasOnlineAccount: boolean;
  mailReturned: boolean;
  priorProceduralLoss: boolean;
  consent: boolean;
  consentSource: string | null;
  notes: string | null;
  /** Dry-run only: which scripted conversation the fake CALL-E server plays. Ignored in live mode. */
  scenario: string | null;
}

/** One outreach campaign, e.g. "January 2027 cohort, first pass". */
export interface Campaign {
  id: string;
  title: string;
  stateId: string;
  rulesId: string;
  source: "manual" | "drill";
  startedAt: string;
  /** The date used for deadline arithmetic (YYYY-MM-DD). */
  asOf: string;
  dueWithinDays: number | null;
}

export type Priority = 1 | 2 | 3;

export interface Wave {
  index: number;
  priority: Priority;
  personIds: string[];
  /** 1 for the first pass, 2 for the redial, 3 for a follow-up. */
  attempt: number;
}

export type CallOutcome = "completed" | "declined_now" | "cut_short" | "voicemail" | "no_person" | "wrong_person";
export type IncomeBand = "under_580" | "580_or_more" | "unknown" | "not_asked";
export type AgentMessage = "may_qualify_exemption" | "may_meet_requirement" | "needs_help" | "nothing";

/** Mirrors SCREENING_RESULT_SCHEMA exactly. */
export interface ScreeningResult {
  call_outcome: CallOutcome;
  identity_confirmed: YesNoUnknown;
  aware_of_rule: YesNoUnknown;
  answers: Record<AskableCode, Answer>;
  frail_daily_limitation: Answer;
  monthly_hours: number;
  income_band: IncomeBand;
  agent_told_them: AgentMessage;
  wants_navigator: YesNoUnknown;
  preferred_callback: string;
  opt_out: "yes" | "no";
  notes: string;
}

/** Still Covered's own verdict after applying fail-closed rules to the agent's result. */
export type Outcome =
  | "cleared_by_data"
  | "likely_exempt"
  | "likely_meets"
  | "at_risk"
  | "needs_review"
  | "declined"
  | "opted_out"
  | "identity_unconfirmed"
  | "unreachable"
  | "unverified"
  | "not_attempted";

export const OUTCOMES: readonly Outcome[] = [
  "cleared_by_data",
  "likely_exempt",
  "likely_meets",
  "at_risk",
  "needs_review",
  "declined",
  "opted_out",
  "identity_unconfirmed",
  "unreachable",
  "unverified",
  "not_attempted",
];

export interface Classification {
  outcome: Outcome;
  reasons: string[];
  /** Exemption categories the answers support. Always "may qualify"; a caseworker decides. */
  exemptions: ExemptionCode[];
  /** The agent told the person more than the rules support; a human must call them back. */
  correctionNeeded: boolean;
  agentSaid: AgentMessage | null;
}

export type ActionType =
  | "none"
  | "packet"
  | "report-reminder"
  | "navigator"
  | "follow-up"
  | "retry"
  | "mail"
  | "suppress"
  | "operator-review"
  | "await-result";

export interface NextAction {
  type: ActionType;
  reason: string;
  /** For retry and follow-up: minutes until the next call. */
  delayMinutes?: number;
  highPriority?: boolean;
}

export type WorkKind =
  | "exemption_packet"
  | "report_hours"
  | "navigator_callback"
  | "mail_letter"
  | "correction_call"
  | "operator_review"
  | "suppression";

/** A worklist item for a caseworker or navigator. Nothing in Still Covered changes coverage itself. */
export interface WorkItem {
  id: string;
  personId: string;
  kind: WorkKind;
  summary: string;
  checklist: string[];
  preferredCallback: string | null;
  checkDate: string | null;
  highPriority: boolean;
  needsHumanReview: boolean;
  reviewedAt: string | null;
  createdAt: string;
}

export interface PersonState {
  personId: string;
  priorityScore: number;
  priority: Priority;
  daysToCheck: number | null;
  attempts: number;
  outcome: Outcome | null;
  reasons: string[];
  exemptions: ExemptionCode[];
  agentSaid: AgentMessage | null;
  correctionNeeded: boolean;
  /** Whether they had heard of the rule before the call. The Arkansas metric. */
  awareBefore: YesNoUnknown | null;
  wantsNavigator: YesNoUnknown | null;
  preferredCallback: string | null;
  lastCallId: string | null;
  lastResult: ScreeningResult | null;
  lastSummary: string | null;
  classifiedAt: string | null;
  nextAction: NextAction | null;
  followUpDueAt: string | null;
  evidence: string[];
}

export interface CallRecord {
  callId: string;
  kind: "screen";
  wave: number | null;
  attempt: number;
  personIds: string[];
  idempotencyKey: string;
  createdAt: string;
  completedAt: string | null;
  status: string;
  taskCompleted: boolean | null;
  confidenceLabel: string | null;
  confidenceScore: number | null;
  failureCode: string | null;
  recipients: { maskedPhone: string; personId: string | null; status: string; attemptCount: number }[];
  /** Seconds before the bot's first transcript turn, per recipient, for the feedback report. */
  firstBotTurnOffsets: (number | null)[];
}
