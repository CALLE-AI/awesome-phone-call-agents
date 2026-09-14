export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type AgeBand = "infant" | "toddler" | "preschool" | "school-age";

export interface SearchBrief {
  ageBand: AgeBand;
  desiredStartDate: string;
  requiredWeekdays: Weekday[];
  dropoffTime: string;
  pickupTime: string;
  budgetMonthlyMinor: number;
  currency: "USD" | "GBP" | "CAD" | "AUD";
  subsidyRequired: boolean;
  targetMatches: number;
}

export interface CenterCandidate {
  id: string;
  name: string;
  neighborhood: string;
  distanceMiles: number;
  source: string;
  demoPhone: string;
  priority: number;
}

export type CenterLineOutcome =
  | "reached_staff"
  | "voicemail"
  | "ivr_dead_end"
  | "disconnected"
  | "wrong_entity"
  | "declined"
  | "unknown";

export type Answer = "yes" | "no" | "unknown";
export type VacancyStatus = "available" | "available_later" | "waitlist" | "full" | "unknown";

export interface CenterResult {
  lineOutcome: CenterLineOutcome;
  businessConfirmed: Answer;
  ageBandAccepted: Answer;
  vacancyStatus: VacancyStatus;
  earliestStartDate: string;
  availableWeekdays: Weekday[];
  openingTime: string;
  closingTime: string;
  monthlyTuitionMinor: number;
  registrationFeeMinor: number;
  subsidyStatus: "accepted" | "not_accepted" | "unknown";
  tourStatus: "offered" | "not_offered" | "unknown";
  tourWindows: string[];
  availabilityEvidence: string;
  scheduleEvidence: string;
  feeEvidence: string;
}

export interface TranscriptTurn {
  offsetSeconds: number | null;
  speaker: "agent" | "recipient" | "unknown";
  text: string;
}

export interface CenterCallRecord {
  candidateId: string;
  status: "planned" | "calling" | "completed" | "failed" | "held";
  result: CenterResult | null;
  source: "fixture" | "calle";
  callId?: string;
  verifiedAt?: string;
  confidence?: number | null;
  summary?: string;
  transcriptTurns?: TranscriptTurn[];
}

export type MatchTier = "qualified" | "partial" | "waitlist" | "unavailable" | "review";

export interface ConstraintCheck {
  key: "identity" | "age" | "vacancy" | "days" | "hours" | "budget" | "subsidy" | "evidence";
  label: string;
  status: "pass" | "fail" | "unknown";
  detail: string;
}

export interface MatchEvaluation {
  candidateId: string;
  tier: MatchTier;
  score: number;
  checks: ConstraintCheck[];
  headline: string;
}

export interface TourRequest {
  candidateId: string;
  parentFirstName: string;
  callbackPhone: string;
  preferredWindow: string;
  alternateWindow: string;
}
