/**
 * Closed vocabulary for Roll Call.
 *
 * Everything CALL-E returns is reduced to these types before any decision is
 * made. The decision layer (decide.ts) is a pure function of these values.
 */

export type Locale = string; // BCP 47, e.g. "en-US", "de-DE"

export interface Guardian {
  /** Display name used on the call, e.g. "Ms. Okafor". */
  name: string;
  /** E.164 phone number. */
  phone: string;
  /** BCP 47 locale hint for the conversation. */
  locale: Locale;
  /** ISO 3166-1 alpha-2 region used by CALL-E for routing and compliance. */
  region: string;
  /** Guardian has agreed to automated attendance calls from the school. */
  automatedCallsConsent: boolean;
}

export interface Absence {
  /** School-internal identifier, never spoken on the call. */
  studentId: string;
  /** Only the first name is ever disclosed on the call. */
  firstName: string;
  /** Class or homeroom label, e.g. "5B". Disclosed only to a verified guardian. */
  classLabel: string;
  /** ISO date of the absence, e.g. "2026-09-14". */
  date: string;
  /** Guardians in the order the school wants them called. */
  guardians: Guardian[];
}

export interface SchoolConfig {
  schoolName: string;
  /** Phone number a guardian can call back, spoken on every call. */
  officePhone: string;
  /** Human who receives safeguarding escalations. */
  safeguardingContact: string;
  /** Local time window in which calls may be placed, 24h "HH:MM". */
  callingWindow: { start: string; end: string };
  /** IANA time zone of the school, e.g. "Europe/Berlin". */
  timeZone: string;
  /** Maximum guardians dialled per student before escalation. */
  maxGuardiansPerStudent: number;
  /** Numbers that must never be dialled, E.164. */
  doNotCall: string[];
}

export interface RollCallInput {
  school: SchoolConfig;
  absences: Absence[];
}

/* ---------- what CALL-E is asked to extract ---------- */

export type AnsweredBy =
  | "guardian"
  | "other_person"
  | "voicemail"
  | "no_answer"
  | "unknown";

export type GuardianAware = "yes" | "no" | "unknown";

export type ReasonCategory =
  | "illness"
  | "medical_appointment"
  | "family"
  | "transport"
  | "on_the_way"
  | "guardian_did_not_know"
  | "other"
  | "unknown";

export type YesNoUnknown = "yes" | "no" | "unknown";

/** Schema-valid structured result CALL-E returns for one guardian call. */
export interface CallExtraction {
  answered_by: AnsweredBy;
  guardian_aware: GuardianAware;
  reason_category: ReasonCategory;
  expected_return: string;
  callback_requested: YesNoUnknown;
  guardian_words: string;
}

/* ---------- what CALL-E actually returned ---------- */

export type CallStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled";

export interface TranscriptTurn {
  offset_seconds: number;
  speaker: "bot" | "user" | "unknown";
  text: string;
}

export interface CallOutcome {
  callId: string;
  status: CallStatus;
  structuredResult: CallExtraction | null;
  summary: string | null;
  transcript: TranscriptTurn[];
  failureCode: string | null;
  failureMessage: string | null;
}

/* ---------- what the school gets back ---------- */

export type Disposition =
  /** A guardian confirmed they know the child is absent and why. */
  | "accounted_for"
  /** A guardian said they did NOT know the child was absent. */
  | "safeguarding_alert"
  /** Guardian reached but the evidence does not support a verdict. */
  | "needs_human_review"
  /** Nobody in the cascade could be reached. */
  | "unreached"
  /** Policy prevented any call (consent, window, do-not-call). */
  | "not_called";

export interface GuardianAttempt {
  guardianIndex: number;
  maskedPhone: string;
  skippedReason: string | null;
  outcome: CallOutcome | null;
  /** Reduced view of the outcome used by the decision layer. */
  reduced: ReducedOutcome | null;
}

export interface ReducedOutcome {
  answeredBy: AnsweredBy;
  guardianAware: GuardianAware;
  reasonCategory: ReasonCategory;
  expectedReturn: string;
  callbackRequested: YesNoUnknown;
  /** Verbatim guardian turn that supports guardianAware, or null. */
  supportingTurn: string | null;
}

export interface StudentDisposition {
  studentId: string;
  firstName: string;
  classLabel: string;
  date: string;
  disposition: Disposition;
  /** Human-readable explanation of why this disposition was chosen. */
  because: string;
  /** Who must act next, if anyone. */
  nextAction: string;
  attempts: GuardianAttempt[];
}

export interface RollCallReport {
  generatedAt: string;
  school: string;
  date: string;
  mode: "preview" | "dry-run" | "live";
  students: StudentDisposition[];
  totals: Record<Disposition, number>;
}
