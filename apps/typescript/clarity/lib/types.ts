/**
 * Domain types for Clarity.
 *
 * Everything CALL-E returns is normalized into these shapes at the
 * `lib/call-record.ts` boundary, so the UI never depends on the provider's wire
 * format or imports its API client.
 */

// ---------------------------------------------------------------------------
// Stage 1 — ambiguity detection
// ---------------------------------------------------------------------------

export type ClarificationSource = "resume" | "answers";

export type Clarification = {
  id: string;
  /** VERBATIM span from the submitted application text. */
  claim: string;
  /**
   * Two to four words naming what the claim is about. This is the BEFORE side
   * of the result reveal, so it has to be the shortest true form of the claim
   * — "98% CSAT", not "Maintained 98% CSAT". Optional because a session stored
   * before this field existed still has to render; `factTopic` falls back to
   * the claim itself.
   */
  topic?: string;
  /**
   * The ambiguity itself, as one short question a reader can grasp at a glance:
   * "Was 98% Devan's own score or the team's?". Distinct from `question`, which
   * is what the caller actually says out loud. Optional for the same reason
   * `topic` is.
   */
  need?: string;
  source: ClarificationSource;
  /** Ties the ambiguity to a specific job-description requirement. */
  whyItMatters: string;
  /** What CALL-E opens with for this item. */
  question: string;
  /** Follow-ups to reach for when the answer leaves something open. */
  probes: string[];
  /** Human-readable names of the specifics worth pulling out of the answer. */
  extract: string[];
};

export type ApplicationInput = {
  jobDescription: string;
  resume: string;
  answers: string;
  candidateName?: string;
  /** The role applied for, shown above the candidate and named on the call. */
  roleTitle?: string;
  /**
   * The number the call will dial, in E.164. Resolved server-side from the
   * submitted text by `lib/phone.ts` — never accepted from the browser, so a
   * number can only ever belong to the application it was read out of. Absent
   * when the application names no number, which is what blocks the call.
   */
  candidatePhone?: string;
};

export type AnalyzeResult = {
  clarifications: Clarification[];
  /** Items the model proposed that failed a guardrail, kept for transparency. */
  rejected: RejectedClarification[];
};

export type RejectedClarification = {
  claim: string;
  reason: "not-verbatim" | "sensitive-attribute" | "over-cap";
};

// ---------------------------------------------------------------------------
// Stage 2/3 — the call
// ---------------------------------------------------------------------------

/** Mirrors CALL-E's `CallStatus`. */
export type CallStatus = "queued" | "in_progress" | "completed" | "failed" | "canceled";

/** Mirrors CALL-E's `AttemptStatus`, which is what the status strip renders. */
export type AttemptStatus =
  | "queued"
  | "dialing"
  | "in_progress"
  | "completed"
  | "failed"
  | "canceled";

export type TranscriptTurn = {
  /** Seconds from the start of the attempt; null when unparseable. */
  offsetSeconds: number | null;
  speaker: "bot" | "user" | "unknown";
  text: string;
};

/**
 * What the call established about the one claim it asked about.
 *
 * The first three fields are the result screen: they are the whole reveal, and
 * they are asked for on the call rather than derived here, because deciding
 * that "ninety-six percent, on about forty-five surveys" reduces to
 * `96% personal` + `45 surveys` is a judgment about someone's words.
 */
export type ClarificationAnswer = {
  /** The AFTER hero. At most five words, leading with the number: `96% personal`. */
  corrected: string;
  /** What the written claim turned out to describe: `98% was the team metric`. */
  correction: string;
  /** The scale or scope the corrected fact rests on: `45 surveys`. `""` if none. */
  basis: string;
  /** One flat sentence-fragment restating the claim as the call left it. */
  headline: string;
  answer: string;
  specifics: string;
  still_unclear: string;
  /** Short form of `still_unclear` for the chip; "" when nothing is open. */
  open_question: string;
  /** Verbatim candidate words that support `answer`; "" when none available. */
  quote: string;
  confidence: "high" | "medium" | "low";
};

/** A `quote` matched back onto a transcript turn so it can carry a timestamp. */
export type Evidence = {
  quote: string;
  offsetSeconds: number | null;
  /** Index into `CallRecord.transcript`; -1 when no turn matched. */
  turnIndex: number;
};

/** The one thing the call was placed to establish. */
export type ClarifiedFact = {
  clarification: Clarification;
  answer: ClarificationAnswer | null;
  evidence: Evidence | null;
};

export type CallRecord = {
  callId: string;
  status: CallStatus;
  attemptStatus: AttemptStatus | null;
  /** CALL-E's own summary of the call outcome. */
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  /** CALL-E's flat post-call evidence list. Supplementary to per-field quotes. */
  taskEvidence: string[];
  transcript: TranscriptTurn[];
  structuredResult: Record<string, unknown> | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

// ---------------------------------------------------------------------------
// Session — what the single-screen UI polls
// ---------------------------------------------------------------------------

export type Session = {
  id: string;
  ownerId?: string;
  authorization?: {
    phone: string;
    region: string;
    locale: string;
    consentAt: string;
    expiresAt: string;
    ownerId: string;
  };
  createState?: "creating" | "ambiguous" | "accepted";
  createdAt: string;
  /** True when this session is rendered from a fixture, not a live call. */
  replay: boolean;
  /** True when the replay fixture is a hand-authored sample, not a real call. */
  synthetic?: boolean;
  application: ApplicationInput;
  /**
   * Ordered most valuable first. Only `clarifications[0]` is called about; the
   * rest are what the analyzer also found, kept so the screen can offer them.
   */
  clarifications: Clarification[];
  callId: string | null;
  call: CallRecord | null;
};

/**
 * One step of the conversation that produced the fact, reconstructed from the
 * transcript. `followUp` is the step the demo turns on: nothing in the written
 * application could have predicted it — it exists only because of what the
 * candidate said a moment earlier.
 */
export type TrailStep = {
  kind: "asked" | "answered" | "followUp";
  text: string;
  offsetSeconds: number | null;
  turnIndex: number;
};

export type ResultView = {
  session: Session;
  /** The single clarified fact the whole screen is built around. */
  fact: ClarifiedFact | null;
  /** How the call got there, in order. Empty until the transcript has turns. */
  trail: TrailStep[];
};
