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
  /** Dry run only: how the fake B2B portal answers a submission for this booking. */
  simulatedGds?: "reject_reschedule" | "reject_refund";
  /** Dry run only: what the airline service desk says when asked to force the change. */
  simulatedAirlineDesk?: "reissued" | "refused" | "callback_later";
}

export interface AirlineRules {
  name: string;
  role: "airline";
  /** E.164 service desk number agents call when the B2B portal refuses a change. */
  supportPhone: string;
  involuntaryDelayMinutes: number;
  voluntary: Record<FareFamily, { rescheduleFee: number; refundPercent: number }>;
  involuntary: { rescheduleFee: number; refundPercent: number; waivesFareDifference: boolean };
  /** Applies instead of `involuntary` when the cause is force majeure. */
  forceMajeure: { rescheduleFee: number; refundPercent: number; waivesFareDifference: boolean };
}

export interface IntermediaryRules {
  name: string;
  role: "distributor" | "ota";
  voluntary: { rescheduleAdminFee: number; refundAdminFee: number };
  involuntary: { rescheduleAdminFee: number; refundAdminFee: number };
  /** Optional; falls back to `involuntary` when missing. */
  forceMajeure?: { rescheduleAdminFee: number; refundAdminFee: number };
}

export type PartyRules = AirlineRules | IntermediaryRules;

export interface FareRules {
  currency: string;
  parties: Record<string, PartyRules>;
}

export type DisruptionKind = "delay" | "cancellation";

/** Force majeure (weather, volcanic ash, airport closure) is outside the airline's control. */
export type DisruptionCause = "operational" | "force_majeure";

export type DisruptionSource =
  | { kind: "manual" }
  /** Pushed by the airline or OTA operations system through the signed webhook. */
  | { kind: "airline_webhook"; eventId: string; receivedAt: string };

export interface Disruption {
  id: string;
  flightId: string;
  kind: DisruptionKind;
  cause: DisruptionCause;
  /** Delay only; 0 for a cancellation. */
  delayMinutes: number;
  reason: string;
  /** Delay only; null when the flight is cancelled and there is nothing to keep. */
  newDeparture: string | null;
  source: DisruptionSource;
  createdAt: string;
  /** The earlier disruption on this flight that this one replaced (a delay that became worse). */
  supersedes?: string;
  /** Set when a later disruption replaced this one; its calls and quotes are no longer valid. */
  supersededBy?: string;
}

export type ChangeCase = "involuntary" | "force_majeure" | "voluntary";

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
  /** null when the flight is cancelled: there is no flight to keep. */
  keep: { newDeparture: string; total: 0 } | null;
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
  /** The recipient's structured result as returned, for calls that are not passenger calls. */
  structured: Record<string, unknown> | null;
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

// ---------------------------------------------------------------- Workflow B

export type RequestKind = "reschedule" | "refund";

/** Where the passenger's request came in. Inbound calls are handled by that channel, not CALL-E. */
export type RequestChannel = "chat" | "web_form" | "phone";

export interface ChangeRequest {
  id: string;
  pnr: string;
  kind: RequestKind;
  /** Reschedule only: the flight the passenger asked for. */
  targetFlightId: string | null;
  channel: RequestChannel;
  createdAt: string;
}

export interface Eligibility {
  eligible: boolean;
  /** Why the request cannot go ahead. Empty when eligible. */
  reasons: string[];
  /** Things the passenger must hear before confirming, such as a zero refund. */
  warnings: string[];
}

export type RequestStatus =
  /** Refused at intake; nothing was quoted. */
  | "ineligible"
  /** Quote sent through the passenger's channel; waiting for a yes. */
  | "quoted"
  | "declined"
  /** The portal accepted the change and the booking is updated. */
  | "completed"
  /** The portal refused a reissue; the airline desk has to be called. */
  | "portal_rejected"
  | "airline_call_in_progress"
  | "needs_review"
  | "resolved_by_human";

export interface AirlineCall {
  destinationMasked: string;
  redirected: boolean;
  idempotencyKey: string;
  task: string;
  callId: string | null;
  status: "submitted" | "in_progress" | "finished" | "uncertain" | "failed_to_submit";
  submittedAt: string;
  nextPollAt: string;
  outcome: CallOutcome | null;
  error: string | null;
}

export interface RequestEntry {
  request: ChangeRequest;
  eligibility: Eligibility;
  /** Priced once at intake; the passenger confirms exactly this. */
  quote: Quote;
  /** The action the request maps to, once eligible. */
  action: Action | null;
  /** What the passenger pays (reschedule) or receives (refund). */
  amount: number | null;
  status: RequestStatus;
  confirmedAt: string | null;
  portal: { kind: "accepted" } | { kind: "rejected"; code: string; message: string } | null;
  airlineCall: AirlineCall | null;
  reviewReasons: string[];
  applied: string | null;
  /** Optional call telling the passenger how the request ended. */
  callback: AirlineCall | null;
  callbackVerdict: { kind: "delivered" } | { kind: "follow_up"; reasons: string[] } | null;
}

/** One webhook delivery from the airline or OTA operations system, kept for dedupe and audit. */
export interface OpsEventRecord {
  eventId: string;
  type: string;
  flightId: string | null;
  receivedAt: string;
  occurredAt: string | null;
  /** created: a disruption was recorded. conflict: it contradicts the flight's current one, so a person must look. */
  /** escalated: a worse disruption replaced the flight's earlier one. */
  status: "created" | "escalated" | "conflict" | "rejected";
  disruptionId: string | null;
  message: string;
}
