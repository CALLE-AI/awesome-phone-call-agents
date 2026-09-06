// Canopy domain vocabulary.
//
// Everything a phone conversation is reduced to is a closed, enumerated value.
// The voice agent fills these in; Canopy's pure functions decide what happens next.

export type HazardId = "heat" | "flood" | "outage-medical" | "smoke" | "boil-water";

export const HAZARD_IDS: readonly HazardId[] = ["heat", "flood", "outage-medical", "smoke", "boil-water"];

export type YesNoUnknown = "yes" | "no" | "unknown";

export type Cooling = "yes" | "no" | "unknown";

/** One opted-in person from the registry. Phone numbers are E.164 and validated on load. */
export interface Person {
  id: string;
  name: string;
  phone: string;
  /** BCP 47 locale hint for CALL-E, e.g. "en-US", "hi-IN", "es-MX". */
  locale: string;
  /** ISO country code used by CALL-E for routing and compliance, e.g. "US", "IN". */
  region: string;
  age: number | null;
  livesAlone: boolean;
  hasCooling: Cooling;
  medicalRisks: string[];
  address: string | null;
  lat: number | null;
  lng: number | null;
  contactName: string | null;
  contactPhone: string | null;
  contactLocale: string | null;
  consent: boolean;
  consentDate: string | null;
  notes: string | null;
  /** Dry-run only: which synthetic conversation the fake CALL-E server should play. Ignored in live mode. */
  scenario: string | null;
}

export type EventSource = "manual" | "nws" | "open-meteo" | "nea-psi" | "drill";

export interface HazardEvent {
  id: string;
  hazard: HazardId;
  /** Human-readable area, e.g. "Maricopa County, AZ" or "Ahmedabad, Gujarat". */
  area: string;
  severity: string;
  headline: string;
  source: EventSource;
  startedAt: string;
  org: string;
  emergencyNumber: string;
  /** Optional resource the agent can point people to (cooling center, shelter, water distribution). */
  resource: string | null;
}

export type Priority = 1 | 2 | 3;

export interface Wave {
  index: number;
  priority: Priority;
  personIds: string[];
  /** 1 for the first pass, 2 for the retry pass. */
  attempt: number;
}

/** How a wave is turned into CALL-E call tasks. */
export type TaskMode = "batch" | "per-person";

/** What the agent is asked to extract for each person. Mirrors the recipient result schema exactly. */
export interface TriageResult {
  answered_by: "person" | "other_person" | "voicemail" | "ivr" | "unknown";
  is_cool: YesNoUnknown;
  hydrated: YesNoUnknown;
  symptoms: string[];
  confusion_suspected: boolean;
  needs: string[];
  tier: "green" | "yellow" | "red";
  notes: string;
}

/** What the agent is asked to extract from an escalation call to a contact or volunteer. */
export interface EscalationResult {
  reached: "yes" | "no" | "unknown";
  will_check: YesNoUnknown;
  eta_minutes: number;
  wants_emergency_services: YesNoUnknown;
  notes: string;
}

/** Canopy's own verdict after applying fail-closed rules to the agent's result. */
export type Outcome = "green" | "yellow" | "red" | "unreachable" | "unverified" | "not_attempted";

export const OUTCOMES: readonly Outcome[] = ["green", "yellow", "red", "unreachable", "unverified", "not_attempted"];

export interface Classification {
  outcome: Outcome;
  reasons: string[];
  /** The agent's own tier, kept beside Canopy's verdict so disagreements are visible. */
  agentTier: "green" | "yellow" | "red" | null;
}

export type ActionType =
  | "close"
  | "follow-up"
  | "retry"
  | "contact-call"
  | "escalate"
  | "door-knock"
  /** CALL-E never accepted the call task; an operator must resume or call by hand. Never escalates. */
  | "operator-review"
  /** The call was accepted but had not finished when the run stopped; `resume` settles it. */
  | "await-result";

export interface NextAction {
  type: ActionType;
  reason: string;
  /** For follow-up: hours until the next check. For retry: minutes until the redial. */
  delayMinutes?: number;
  /** For escalate and contact-call: whether a human must approve emergency services. */
  suggestEmergencyServices?: boolean;
}

export interface DispatchTicket {
  id: string;
  personId: string;
  kind: "contact_committed" | "volunteer_needed" | "door_knock" | "emergency_services" | "not_attempted";
  summary: string;
  etaMinutes: number | null;
  needsHumanApproval: boolean;
  approvedAt: string | null;
  createdAt: string;
}

export interface PersonState {
  personId: string;
  riskScore: number;
  priority: Priority;
  attempts: number;
  outcome: Outcome | null;
  agentTier: "green" | "yellow" | "red" | null;
  reasons: string[];
  lastCallId: string | null;
  lastResult: TriageResult | null;
  lastSummary: string | null;
  classifiedAt: string | null;
  nextAction: NextAction | null;
  followUpDueAt: string | null;
  contactCalled: boolean;
  contactResult: EscalationResult | null;
  evidence: string[];
}

export interface CallRecord {
  callId: string;
  kind: "wave" | "escalation";
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
  /** Per-recipient masked phone and status, for the timeline. */
  recipients: { maskedPhone: string; personId: string | null; status: string; attemptCount: number }[];
  /** Seconds before the bot's first transcript turn, per recipient, for the feedback report. */
  firstBotTurnOffsets: (number | null)[];
}
