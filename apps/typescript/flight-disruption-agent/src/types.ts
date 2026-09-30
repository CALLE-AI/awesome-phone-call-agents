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
  /** Dry run only: what the airline service desk says when CALL-E asks it to make the change. Defaults to approving. */
  simulatedAirlineDesk?: "approves" | "refused" | "callback_later";
}

export interface AirlineRules {
  name: string;
  role: "airline";
  /** E.164 travel agent service desk number CALL-E calls to make a change the passenger agreed. */
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
  | { kind: "airline_webhook"; eventId: string; receivedAt: string }
  /** Pulled by the desk from the airline's event feed. */
  | { kind: "airline_feed"; eventId: string; receivedAt: string };

/** How an ops event reached the desk. */
export type OpsEventVia = "webhook" | "feed";

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

/** What the passenger asked for when they got in touch. They choose for sure on the CALL-E call. */
export type RequestKind = "reschedule" | "refund" | "change";

/** Where the passenger's request came in. Inbound calls are handled by that channel, not CALL-E. */
export type RequestChannel = "chat" | "web_form" | "phone";

export interface ChangeRequest {
  id: string;
  pnr: string;
  kind: RequestKind;
  /** Reschedule only: the flight the passenger mentioned. They choose for sure on the call. */
  targetFlightId: string | null;
  channel: RequestChannel;
  createdAt: string;
  /** Set when the request came in through the channel webhook; updates go back to that conversation. */
  conversation?: { channel: RequestChannel; id: string };
}

export interface Eligibility {
  eligible: boolean;
  /** Why the request cannot go ahead. Empty when eligible. */
  reasons: string[];
  /** Things the passenger must hear before confirming, such as a zero refund. */
  warnings: string[];
}

export type RequestStatus =
  /** Refused at intake; nothing was offered. */
  | "ineligible"
  /** Priced and eligible; CALL-E has not called the passenger yet. */
  | "awaiting_call"
  | "passenger_call_in_progress"
  /** The passenger chose to keep the booking on the call. Nothing changes. */
  | "declined"
  /** The passenger chose and consented on the call; the airline desk is next. */
  | "confirmed_on_call"
  | "airline_call_in_progress"
  /** The airline desk made the change and the booking is updated. */
  | "completed"
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
  /** Priced once at intake; the CALL-E call offers exactly these options. */
  quote: Quote;
  /** The change the passenger chose on the call. Null until then. */
  action: Action | null;
  /** What the passenger agreed to pay (move) or receive (refund) on the call. */
  amount: number | null;
  status: RequestStatus;
  confirmedAt: string | null;
  /** The passenger's consent is taken on the CALL-E call; the quoted reason is kept for audit. */
  confirmedBy?: { kind: "call"; callId: string | null; reason: string };
  /** CALL-E's call to the passenger: offers the options and records the choice. */
  passengerCall: AirlineCall | null;
  airlineCall: AirlineCall | null;
  reviewReasons: string[];
  applied: string | null;
  /** Optional call telling the passenger how the request ended. */
  callback: AirlineCall | null;
  callbackVerdict: { kind: "delivered" } | { kind: "follow_up"; reasons: string[] } | null;
  /** Status updates sent back to the passenger's channel after the first reply. */
  channelUpdates?: ChannelUpdate[];
}

export interface ChannelUpdate {
  at: string;
  status: RequestStatus;
  reply: string;
  delivery: "sending" | "sent" | "failed" | "not_configured";
  error: string | null;
}

/** One message from the chat, web form, or phone line integration, kept for dedupe and audit. */
export interface ChannelMessageRecord {
  messageId: string;
  type: string;
  channel: RequestChannel;
  conversationId: string;
  receivedAt: string;
  requestId: string | null;
  /** What the channel should show or say to the passenger. */
  reply: string;
  outcome: "accepted" | "refused";
}

/** One webhook delivery from the airline or OTA operations system, kept for dedupe and audit. */
export interface OpsEventRecord {
  eventId: string;
  via: OpsEventVia;
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
