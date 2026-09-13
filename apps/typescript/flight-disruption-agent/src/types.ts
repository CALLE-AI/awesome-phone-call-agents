export type FareFamily = "flex" | "saver" | "basic";

export interface Flight {
  id: string;
  code: string;
  origin: string;
  originCity: string;
  destination: string;
  destinationCity: string;
  /** ISO timestamp with the origin airport's UTC offset. */
  departure: string;
  seatsAvailable: number;
  fares: Record<FareFamily, number>;
}

export type SimulatedAnswer =
  | { kind: "keep" }
  | { kind: "refund" }
  | { kind: "move"; flightId: string }
  | { kind: "human" }
  | { kind: "no_answer" };

export interface Booking {
  pnr: string;
  passenger: string;
  /** E.164. Fixture numbers are fictional and are never dialed. */
  phone: string;
  flightId: string;
  fareFamily: FareFamily;
  farePaid: number;
  /** Seller first, airline last: who sold the ticket to whom. */
  channel: string[];
  ticket: string;
  /** Used only by the dry-run gateway to script a plausible call. */
  simulatedAnswer: SimulatedAnswer;
}

export interface AirlineRules {
  name: string;
  role: "airline";
  involuntaryDelayMinutes: number;
  voluntary: Record<FareFamily, { rescheduleFee: number; refundPercent: number }>;
  involuntary: { rescheduleFee: number; refundPercent: number; waivesFareDifference: boolean };
}

export interface IntermediaryRules {
  name: string;
  role: "distributor" | "ota";
  voluntary: { rescheduleAdminFee: number; refundAdminFee: number };
  involuntary: { rescheduleAdminFee: number; refundAdminFee: number };
}

export type PartyRules = AirlineRules | IntermediaryRules;

export interface FareRules {
  currency: string;
  parties: Record<string, PartyRules>;
}

export interface Disruption {
  id: string;
  flightId: string;
  delayMinutes: number;
  reason: string;
  newDeparture: string;
  createdAt: string;
}

export type ChangeCase = "involuntary" | "voluntary";

export interface QuoteLine {
  party: string;
  label: string;
  /** Positive = the passenger pays; negative = deducted from a refund. */
  amount: number;
}

export interface MoveOption {
  id: string;
  flightId: string;
  label: string;
  departure: string;
  seatsAvailable: number;
  lines: QuoteLine[];
  total: number;
}

export interface Quote {
  pnr: string;
  changeCase: ChangeCase;
  thresholdMinutes: number;
  keep: { newDeparture: string; total: 0 };
  moves: MoveOption[];
  refund: { gross: number; lines: QuoteLine[]; amount: number };
}

export type Choice = "keep_delayed_flight" | "move_to_other_flight" | "refund" | "undecided" | "unknown";

export interface PassengerResult {
  choice: Choice;
  selected_flight: string;
  fee_accepted: "yes" | "no" | "not_applicable" | "unknown";
  human_requested: "yes" | "no" | "unknown";
  reason: string;
}

export interface TranscriptTurn {
  speaker: string;
  text: string;
  offsetSeconds?: number;
}

/** Gateway-neutral view of a call, whatever path placed it. */
export interface CallOutcome {
  state: "in_progress" | "completed" | "failed" | "canceled";
  providerStatus: string;
  taskCompleted: boolean | null;
  confidence: { score: number; label: string } | null;
  result: PassengerResult | null;
  summary: string | null;
  transcript: TranscriptTurn[];
  failureCode: string | null;
  failureMessage: string | null;
  /** CLI mode only: free-text hint because there is no structured result. */
  hint?: string;
}

export type Action =
  | { kind: "keep" }
  | { kind: "move"; optionId: string }
  | { kind: "refund" };

export type Decision =
  | { kind: "apply"; action: Action }
  | { kind: "review"; reasons: string[] };

export type LedgerStatus =
  | "submitted"
  | "uncertain"
  | "in_progress"
  | "applied"
  | "needs_review"
  | "resolved_by_human"
  | "failed_to_submit";

export interface LedgerEntry {
  key: string;
  disruptionId: string;
  pnr: string;
  mode: string;
  destinationMasked: string;
  redirected: boolean;
  idempotencyKey: string;
  /** The options exactly as offered on this call; decisions use this, not today's prices. */
  quote: Quote;
  task: string;
  callId: string | null;
  status: LedgerStatus;
  submittedAt: string;
  nextPollAt: string;
  outcome: CallOutcome | null;
  decision: Decision | null;
  applied: string | null;
  error: string | null;
}

export interface BookingState {
  pnr: string;
  status: "ticketed" | "kept_on_delayed_flight" | "rebooked" | "refunded";
  flightId: string;
  currentPnr: string;
  ticket: string;
  charges: QuoteLine[];
  refundAmount: number | null;
  notes: string[];
}
