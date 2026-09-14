import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CalleAPIError,
  CalleClient,
  type Call,
} from "@call-e/calle";
import type { Booking, CallOutcome, ChangeRequest, MoveOption, PassengerResult, Quote, TranscriptTurn } from "./types.ts";

export interface StartRequest {
  task: string;
  phone: string;
  region: string;
  locale: string;
  resultSchema: Record<string, unknown>;
  metadata: Record<string, string>;
  idempotencyKey: string;
  /** Dry-run only: what the scripted call should play out. */
  simulation: Simulation;
}

export type Simulation =
  | { kind: "passenger"; booking: Booking; quote: Quote }
  | { kind: "request_intake"; booking: Booking; quote: Quote; request: ChangeRequest }
  | { kind: "airline_desk"; booking: Booking; option: MoveOption }
  | { kind: "airline_refund_desk"; booking: Booking; airlineRefund: number }
  | { kind: "result_callback"; booking: Booking };

export type StartResult =
  | { kind: "started"; callId: string }
  /** CALL-E may or may not have accepted the call. Never resubmit automatically. */
  | { kind: "uncertain"; message: string }
  /** CALL-E definitely did not start a call. */
  | { kind: "rejected"; message: string };

export interface CallGateway {
  readonly mode: "dry-run" | "sdk" | "cli";
  readonly live: boolean;
  /** Seconds to wait before the first status check. */
  readonly firstPollSeconds: number;
  readonly pollSeconds: number;
  start(request: StartRequest): Promise<StartResult>;
  get(callId: string): Promise<CallOutcome>;
}

const CHOICES = new Set(["keep_delayed_flight", "move_to_other_flight", "refund", "undecided", "unknown"]);

function asPassengerResult(value: unknown): PassengerResult | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.choice !== "string" || !CHOICES.has(v.choice)) return null;
  return {
    choice: v.choice as PassengerResult["choice"],
    selected_flight: typeof v.selected_flight === "string" ? v.selected_flight : "none",
    fee_accepted: (["yes", "no", "not_applicable"].includes(String(v.fee_accepted)) ? v.fee_accepted : "unknown") as PassengerResult["fee_accepted"],
    human_requested: (["yes", "no"].includes(String(v.human_requested)) ? v.human_requested : "unknown") as PassengerResult["human_requested"],
    reason: typeof v.reason === "string" ? v.reason : "",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------- dry run

interface FakeCall {
  request: StartRequest;
  readyAt: number;
}

/** Scripted CALL-E stand-in. Never touches the network. */
export class DryRunGateway implements CallGateway {
  readonly mode = "dry-run" as const;
  readonly live = false;
  readonly firstPollSeconds: number;
  readonly pollSeconds: number;
  private calls = new Map<string, FakeCall>();
  private seq = 0;

  constructor(private readonly simulatedSeconds = 5) {
    this.firstPollSeconds = Math.min(2, simulatedSeconds);
    this.pollSeconds = Math.min(2, simulatedSeconds);
  }

  async start(request: StartRequest): Promise<StartResult> {
    this.seq += 1;
    const callId = `dryrun_${String(this.seq).padStart(4, "0")}`;
    this.calls.set(callId, { request, readyAt: Date.now() + this.simulatedSeconds * 1000 });
    return { kind: "started", callId };
  }

  async get(callId: string): Promise<CallOutcome> {
    const call = this.calls.get(callId);
    if (!call) throw new Error(`Unknown dry-run call ${callId}`);
    if (Date.now() < call.readyAt) {
      return {
        state: "in_progress",
        providerStatus: "in_progress",
        taskCompleted: null,
        confidence: null,
        result: null,
        structured: null,
        summary: null,
        transcript: [],
        failureCode: null,
        failureMessage: null,
      };
    }
    const sim = call.request.simulation;
    if (sim.kind === "passenger") return scriptedOutcome(sim.booking, sim.quote);
    if (sim.kind === "request_intake") return scriptedIntake(sim.booking, sim.quote, sim.request);
    if (sim.kind === "airline_desk") return scriptedAirlineDesk(sim.booking, sim.option);
    if (sim.kind === "airline_refund_desk") return scriptedAirlineRefundDesk(sim.booking, sim.airlineRefund);
    return scriptedCallback(sim.booking);
  }
}

/**
 * The passenger's side of a Workflow B intake call. A request that names a refund or a flight
 * plays out that choice; an open "change" request follows the booking's scripted answer.
 */
function scriptedIntake(booking: Booking, quote: Quote, request: ChangeRequest): CallOutcome {
  const name = booking.passenger.split(" ")[0];
  const opening: TranscriptTurn[] = [
    { speaker: "bot", text: `Hi, this is an AI assistant calling for TripKita. May I speak with ${booking.passenger}?`, offsetSeconds: 0 },
    { speaker: "user", text: "Speaking.", offsetSeconds: 4 },
    { speaker: "bot", text: "You asked us to change your booking. You can move to a later flight, cancel for a refund, or keep it as it is.", offsetSeconds: 7 },
  ];
  const base = { state: "completed" as const, providerStatus: "completed", result: null, failureCode: null, failureMessage: null };
  const answer = booking.simulatedAnswer;
  let choice: "move" | "refund" | "keep" | "human" | "no_answer" =
    request.kind === "refund" ? "refund" : request.kind === "reschedule" ? "move" : answer.kind;
  const target =
    quote.moves.find((m) => m.flightId === request.targetFlightId) ??
    (answer.kind === "move" ? quote.moves.find((m) => m.flightId === answer.flightId) : undefined) ??
    quote.moves[0];
  if (choice === "move" && !target) choice = "human";

  if (choice === "no_answer") {
    return { ...base, state: "failed", providerStatus: "failed", taskCompleted: false, confidence: null, structured: null, summary: "No one answered the call.", transcript: [], failureCode: "no_answer", failureMessage: "No human answered the call." };
  }
  if (choice === "human") {
    return {
      ...base,
      taskCompleted: false,
      confidence: { score: 0.86, label: "high" },
      structured: { choice: "unknown", selected_flight: "none", fee_accepted: "unknown", human_requested: "yes", reason: "Passenger said: I'd rather sort this out with a person." },
      summary: `${name} asked to speak with a human agent.`,
      transcript: [...opening, { speaker: "user", text: "I'd rather sort this out with a person.", offsetSeconds: 14 }],
    };
  }
  if (choice === "keep") {
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.92, label: "high" },
      structured: { choice: "no_change", selected_flight: "none", fee_accepted: "not_applicable", human_requested: "no", reason: "Passenger said: Actually, leave it as it is." },
      summary: `${name} decided to keep the booking unchanged.`,
      transcript: [...opening, { speaker: "user", text: "Actually, leave it as it is.", offsetSeconds: 14 }],
    };
  }
  if (choice === "refund") {
    const reduced = quote.refund.amount < quote.refund.gross;
    const amount = quote.refund.amount.toLocaleString("en-US");
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.9, label: "high" },
      structured: { choice: "refund", selected_flight: "none", fee_accepted: reduced ? "yes" : "not_applicable", human_requested: "no", reason: `Passenger said: Cancel it, I accept ${amount} rupiah back.` },
      summary: `${name} chose to cancel for a refund of IDR ${amount}.`,
      transcript: [
        ...opening,
        { speaker: "user", text: "I'd like to cancel. How much do I get back?", offsetSeconds: 14 },
        { speaker: "bot", text: `The refund is ${amount} rupiah. Do you accept?`, offsetSeconds: 18 },
        { speaker: "user", text: `Yes, cancel it, I accept ${amount} rupiah back.`, offsetSeconds: 23 },
        { speaker: "bot", text: "Thank you. TripKita will now arrange this with the airline and send you the confirmation.", offsetSeconds: 27 },
      ],
    };
  }
  const option = target as MoveOption;
  const cost = option.total.toLocaleString("en-US");
  return {
    ...base,
    taskCompleted: true,
    confidence: { score: 0.91, label: "high" },
    structured: {
      choice: "move_to_other_flight",
      selected_flight: option.flightId,
      fee_accepted: option.total > 0 ? "yes" : "not_applicable",
      human_requested: "no",
      reason: `Passenger said: Move me to ${option.label}${option.total > 0 ? `, I'm okay paying ${cost} rupiah` : ""}.`,
    },
    summary: `${name} chose ${option.label}${option.total > 0 ? ` and agreed to pay IDR ${cost}` : ""}.`,
    transcript: [
      ...opening,
      { speaker: "user", text: `Can you move me to ${option.label}?`, offsetSeconds: 14 },
      { speaker: "bot", text: option.total > 0 ? `That costs ${cost} rupiah. Do you agree?` : "That has no cost. Shall I go ahead?", offsetSeconds: 18 },
      { speaker: "user", text: "Yes, go ahead.", offsetSeconds: 22 },
      { speaker: "bot", text: "Thank you. TripKita will now arrange this with the airline and send you the confirmation.", offsetSeconds: 26 },
    ],
  };
}

function scriptedOutcome(booking: Booking, quote: Quote): CallOutcome {
  const name = booking.passenger.split(" ")[0];
  const opening: TranscriptTurn[] = [
    { speaker: "bot", text: `Hi, this is an AI assistant calling for TripKita. May I speak with ${booking.passenger}?`, offsetSeconds: 0 },
    { speaker: "user", text: "Speaking.", offsetSeconds: 4 },
    {
      speaker: "bot",
      text: quote.keep
        ? "Your flight is delayed. You can keep the new time, move to another flight, or cancel for a refund."
        : "Your flight is cancelled. You can move to another flight or cancel for a refund.",
      offsetSeconds: 7,
    },
  ];
  const base = {
    structured: null,
    state: "completed" as const,
    providerStatus: "completed",
    failureCode: null,
    failureMessage: null,
  };
  const answer = booking.simulatedAnswer;

  if (answer.kind === "no_answer") {
    return {
      ...base,
      state: "failed",
      providerStatus: "failed",
      taskCompleted: false,
      confidence: null,
      result: null,
      structured: null,
      summary: "No one answered the call.",
      transcript: [],
      failureCode: "no_answer",
      failureMessage: "No human answered the call.",
    };
  }
  if (answer.kind === "human") {
    return {
      ...base,
      taskCompleted: false,
      confidence: { score: 0.86, label: "high" },
      result: {
        choice: "unknown",
        selected_flight: "none",
        fee_accepted: "unknown",
        human_requested: "yes",
        reason: "Passenger said: I'd rather talk to a real person about this.",
      },
      summary: `${name} asked to speak with a human agent before choosing.`,
      transcript: [...opening, { speaker: "user", text: "I'd rather talk to a real person about this.", offsetSeconds: 15 }],
    };
  }
  if (answer.kind === "keep") {
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.93, label: "high" },
      result: {
        choice: "keep_delayed_flight",
        selected_flight: "none",
        fee_accepted: "not_applicable",
        human_requested: "no",
        reason: "Passenger said: That's fine, I'll keep the later time.",
      },
      summary: `${name} will keep the delayed flight.`,
      transcript: [...opening, { speaker: "user", text: "That's fine, I'll keep the later time.", offsetSeconds: 14 }],
    };
  }
  if (answer.kind === "refund") {
    const reduced = quote.refund.amount < quote.refund.gross;
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.9, label: "high" },
      result: {
        choice: "refund",
        selected_flight: "none",
        fee_accepted: reduced ? "yes" : "not_applicable",
        human_requested: "no",
        reason: `Passenger said: Please cancel it, I accept the refund of ${quote.refund.amount.toLocaleString("en-US")} rupiah.`,
      },
      summary: `${name} chose a refund of IDR ${quote.refund.amount.toLocaleString("en-US")}.`,
      transcript: [
        ...opening,
        { speaker: "user", text: "Please cancel it. How much do I get back?", offsetSeconds: 14 },
        { speaker: "bot", text: `The refund is ${quote.refund.amount.toLocaleString("en-US")} rupiah. Do you accept?`, offsetSeconds: 18 },
        { speaker: "user", text: "Yes, I accept.", offsetSeconds: 23 },
      ],
    };
  }
  const option = quote.moves.find((m) => m.flightId === answer.flightId);
  if (!option) {
    return {
      ...base,
      taskCompleted: false,
      confidence: { score: 0.55, label: "low" },
      result: { choice: "unknown", selected_flight: "none", fee_accepted: "unknown", human_requested: "no", reason: "The flight the passenger wanted was not offered." },
      summary: `${name} asked for a flight that was not available.`,
      transcript: opening,
    };
  }
  return {
    ...base,
    taskCompleted: true,
    confidence: { score: 0.91, label: "high" },
    result: {
      choice: "move_to_other_flight",
      selected_flight: option.flightId,
      fee_accepted: option.total > 0 ? "yes" : "not_applicable",
      human_requested: "no",
      reason: `Passenger said: Move me to ${option.label}${option.total > 0 ? `, I'm okay paying ${option.total.toLocaleString("en-US")} rupiah` : ""}.`,
    },
    summary: `${name} moved to ${option.label}.`,
    transcript: [
      ...opening,
      { speaker: "user", text: `Can you move me to ${option.label}?`, offsetSeconds: 14 },
      { speaker: "bot", text: option.total > 0 ? `That costs ${option.total.toLocaleString("en-US")} rupiah. Do you agree?` : "That has no cost. Shall I confirm it?", offsetSeconds: 18 },
      { speaker: "user", text: "Yes, go ahead.", offsetSeconds: 22 },
    ],
  };
}

function scriptedAirlineRefundDesk(booking: Booking, airlineRefund: number): CallOutcome {
  const amount = airlineRefund.toLocaleString("en-US");
  const opening: TranscriptTurn[] = [
    { speaker: "user", text: "Nusantara Air agency desk, how can I help?", offsetSeconds: 0 },
    { speaker: "bot", text: `Hi, I'm an AI assistant calling for TripKita. The passenger on booking ${booking.pnr} has cancelled. Can you approve a refund of ${amount} rupiah?`, offsetSeconds: 3 },
  ];
  const base = { state: "completed" as const, providerStatus: "completed", result: null, failureCode: null, failureMessage: null };
  const answer = booking.simulatedAirlineDesk ?? "approves";
  if (answer === "approves") {
    const reference = `NA-RF-${booking.ticket.slice(-4)}`;
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.91, label: "high" },
      structured: {
        outcome: "refund_approved",
        approved_refund_amount: String(airlineRefund),
        refund_reference: reference,
        reduced_refund_offered: "no",
        reason: `Desk agent said: Approved, ${amount} rupiah back to your agency account.`,
      },
      summary: `The Nusantara Air desk approved a refund of ${amount} rupiah for ${booking.pnr}, reference ${reference}.`,
      transcript: [
        ...opening,
        { speaker: "user", text: `Approved. ${amount} rupiah back to your agency account, reference ${reference}.`, offsetSeconds: 35 },
        { speaker: "bot", text: `Reading back: ${amount} rupiah, reference ${reference.split("").join(" ")}. Thank you.`, offsetSeconds: 42 },
      ],
    };
  }
  if (answer === "refused") {
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.88, label: "high" },
      structured: { outcome: "refused", approved_refund_amount: "none", refund_reference: "none", reduced_refund_offered: "no", reason: "Desk agent said: This fare can only be refunded as a voucher." },
      summary: `The Nusantara Air desk refused a cash refund for ${booking.pnr}.`,
      transcript: [...opening, { speaker: "user", text: "Sorry, this fare can only be refunded as a voucher.", offsetSeconds: 20 }],
    };
  }
  return {
    ...base,
    taskCompleted: false,
    confidence: { score: 0.8, label: "high" },
    structured: { outcome: "callback_later", approved_refund_amount: "none", refund_reference: "none", reduced_refund_offered: "unknown", reason: "Desk agent said: Refunds are handled after 2 pm, please call back." },
    summary: "The Nusantara Air desk asked for a call back later.",
    transcript: [...opening, { speaker: "user", text: "Refunds are handled after 2 pm, please call back.", offsetSeconds: 12 }],
  };
}

function scriptedAirlineDesk(booking: Booking, option: MoveOption): CallOutcome {
  const opening: TranscriptTurn[] = [
    { speaker: "user", text: "Nusantara Air agency desk, how can I help?", offsetSeconds: 0 },
    { speaker: "bot", text: `Hi, I'm an AI assistant calling for TripKita. The passenger on booking ${booking.pnr} has agreed to move to ${option.label}. Can you reissue the ticket?`, offsetSeconds: 3 },
  ];
  const base = {
    state: "completed" as const,
    providerStatus: "completed",
    result: null,
    failureCode: null,
    failureMessage: null,
  };
  const answer = booking.simulatedAirlineDesk ?? "approves";
  if (answer === "approves") {
    const code = `Q${booking.pnr.slice(1, 5)}Z`;
    const ticket = `0002419${booking.ticket.slice(-6)}`;
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.92, label: "high" },
      structured: {
        outcome: "reissued",
        new_booking_code: code,
        new_ticket_number: ticket,
        airline_reference: `NA-DESK-${booking.ticket.slice(-4)}`,
        extra_charge_requested: "no",
        reason: `Desk agent said: Done, I've reissued it to ${option.label}.`,
      },
      summary: `The Nusantara Air desk reissued ${booking.pnr} to ${option.label} with booking code ${code}.`,
      transcript: [
        ...opening,
        { speaker: "user", text: `One moment. Done, I've reissued it to ${option.label}. New booking code ${code}, ticket ${ticket}.`, offsetSeconds: 40 },
        { speaker: "bot", text: `Reading back: booking code ${code.split("").join(" ")}, ticket ${ticket}. Thank you.`, offsetSeconds: 48 },
      ],
    };
  }
  if (answer === "refused") {
    return {
      ...base,
      taskCompleted: true,
      confidence: { score: 0.88, label: "high" },
      structured: {
        outcome: "refused",
        new_booking_code: "none",
        new_ticket_number: "none",
        airline_reference: "none",
        extra_charge_requested: "no",
        reason: "Desk agent said: Basic fares can't be reissued, not even manually.",
      },
      summary: `The Nusantara Air desk refused to reissue ${booking.pnr}.`,
      transcript: [...opening, { speaker: "user", text: "Sorry, basic fares can't be reissued, not even manually.", offsetSeconds: 25 }],
    };
  }
  return {
    ...base,
    taskCompleted: false,
    confidence: { score: 0.8, label: "high" },
    structured: {
      outcome: "callback_later",
      new_booking_code: "none",
      new_ticket_number: "none",
      airline_reference: "none",
      extra_charge_requested: "unknown",
      reason: "Desk agent said: The system is down, please call back in an hour.",
    },
    summary: "The Nusantara Air desk asked for a call back later.",
    transcript: [...opening, { speaker: "user", text: "Our system is down, please call back in an hour.", offsetSeconds: 12 }],
  };
}

function scriptedCallback(booking: Booking): CallOutcome {
  const name = booking.passenger.split(" ")[0];
  return {
    state: "completed",
    providerStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.9, label: "high" },
    result: null,
    structured: {
      reached_passenger: "yes",
      acknowledged: "yes",
      follow_up_requested: "no",
      reason: "Passenger said: Got it, thanks for letting me know.",
    },
    summary: `${name} heard the result of their request and understood it.`,
    transcript: [
      { speaker: "bot", text: `Hi, this is an AI assistant calling for TripKita. May I speak with ${booking.passenger}?`, offsetSeconds: 0 },
      { speaker: "user", text: "Speaking.", offsetSeconds: 3 },
      { speaker: "bot", text: "I'm calling with the result of the change you asked for.", offsetSeconds: 6 },
      { speaker: "user", text: "Got it, thanks for letting me know.", offsetSeconds: 20 },
    ],
    failureCode: null,
    failureMessage: null,
  };
}

// ---------------------------------------------------------------- SDK

function normalizeSdkCall(call: Call): CallOutcome {
  const recipient = call.recipients[0];
  const attempts = recipient?.attempts ?? [];
  const lastAttempt = attempts[attempts.length - 1];
  const transcript: TranscriptTurn[] = attempts.flatMap((a) =>
    (a.transcriptTurns ?? []).map((t) => {
      const turn = t as unknown as Record<string, unknown>;
      return {
        speaker: String(turn.speaker ?? ""),
        text: String(turn.text ?? ""),
        offsetSeconds: typeof turn.offset_seconds === "number" ? turn.offset_seconds : undefined,
      };
    }),
  );
  let state: CallOutcome["state"] =
    call.status === "completed" ? "completed" : call.status === "failed" ? "failed" : call.status === "canceled" ? "canceled" : "in_progress";
  if (state === "completed" && recipient && recipient.status !== "completed") state = "failed";
  return {
    state,
    providerStatus: recipient ? `${call.status} / recipient ${recipient.status}` : call.status,
    taskCompleted: call.taskCompleted,
    confidence: call.completionConfidence ? { score: call.completionConfidence.score, label: call.completionConfidence.label } : null,
    result: asPassengerResult(recipient?.structuredResult),
    structured: asRecord(recipient?.structuredResult),
    summary: recipient?.summary ?? call.summary,
    transcript,
    failureCode: lastAttempt?.failureCode ?? call.failureCode,
    failureMessage: lastAttempt?.failureMessage ?? call.failureMessage,
  };
}

/** Developer API through the official SDK. Needs CALLE_API_KEY. */
export class SdkGateway implements CallGateway {
  readonly mode = "sdk" as const;
  readonly live = true;
  readonly firstPollSeconds = 60;
  readonly pollSeconds = 10;
  private client: CalleClient;

  constructor(apiKey: string) {
    this.client = new CalleClient({ apiKey });
  }

  async start(request: StartRequest): Promise<StartResult> {
    try {
      const call = await this.client.calls.create(
        {
          task: request.task,
          recipients: [{ phones: [request.phone], region: request.region, locale: request.locale }],
          recipientResultSchema: request.resultSchema,
          metadata: request.metadata,
        },
        { idempotencyKey: request.idempotencyKey },
      );
      return { kind: "started", callId: call.id };
    } catch (error) {
      if (error instanceof CalleAPIError) {
        return { kind: "rejected", message: `${error.code}: ${error.message}` };
      }
      return { kind: "uncertain", message: error instanceof Error ? error.message : String(error) };
    }
  }

  async get(callId: string): Promise<CallOutcome> {
    return normalizeSdkCall(await this.client.calls.get(callId));
  }
}

// ---------------------------------------------------------------- CLI

const CLI_TERMINAL_FAILED = new Set(["FAILED", "NO_ANSWER", "NO ANSWER", "DECLINED", "VOICEMAIL", "BUSY", "EXPIRED"]);

/**
 * The CALL-E CLI (`@call-e/cli`). The SDK this app depends on also installs a `calle`
 * command, and `npm run` puts it first on PATH, so the MCP CLI is located explicitly:
 * CALLE_CLI if set, else the global @call-e/cli install, else `calle` on PATH.
 */
export function resolveCalleCli(configured?: string): string[] {
  if (configured) return configured.endsWith(".js") ? [process.execPath, configured] : [configured];
  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const entry = join(root, "@call-e", "cli", "bin", "calle.js");
    if (existsSync(entry)) return [process.execPath, entry];
  } catch {
    // fall through to PATH
  }
  return ["calle"];
}

function runCli(command: string[], args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
  const [bin, ...prefix] = command;
  return new Promise((resolve, reject) => {
    execFile(bin as string, [...prefix, ...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const start = stdout.indexOf("{");
      if (start === -1) {
        // Report what the CLI said, not the whole command line (it contains the call task).
        const said = String(stderr || "").trim().split("\n").pop();
        reject(new Error(said || (error?.killed ? "calle CLI timed out" : "calle CLI returned no JSON")));
        return;
      }
      const parsed = firstJsonObject(stdout.slice(start));
      if (parsed) resolve(parsed);
      else reject(error ?? new Error("calle CLI returned invalid JSON"));
    });
  });
}

/** The first complete JSON object in the text; the CLI may print a plain-text line after it. */
function firstJsonObject(text: string): Record<string, unknown> | null {
  for (let end = text.lastIndexOf("}"); end > 0; end = text.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(text.slice(0, end + 1)) as Record<string, unknown>;
    } catch {
      // keep trimming
    }
  }
  return null;
}

// ---------------------------------------------------------------- plan check (no call)

export interface PlanCheck {
  ready: boolean;
  questions: string[];
  /** CALL-E's own restatement of the call goal, with its success and failure criteria. */
  goal: string | null;
}

/** Asks CALL-E to plan a call without running it. Never dials. */
export interface Planner {
  plan(input: { phone: string; region: string; task: string }): Promise<PlanCheck>;
}

/**
 * Uses the local `calle` CLI and its browser login to call CALL-E's `plan_call` tool.
 * Planning never places a call; the confirmation token CALL-E returns is dropped here,
 * so this plan can never be run from the desk.
 */
export class CliPlanner implements Planner {
  private readonly bin: string[];
  constructor(configured?: string) {
    this.bin = resolveCalleCli(configured);
  }

  async plan(input: { phone: string; region: string; task: string }): Promise<PlanCheck> {
    const out = await runCli(
      this.bin,
      ["call", "plan", "--to-phone", input.phone, "--goal", input.task, "--region", input.region, "--language", "English"],
      200_000,
    );
    if (out.ok === false) {
      const err = (out.error ?? {}) as Record<string, unknown>;
      if (err.code === "plan_not_ready") {
        return { ready: false, questions: [String(err.message ?? "CALL-E needs more information.")], goal: null };
      }
      if (err.code === "auth_required") throw new Error("CALL-E login required: run `calle auth login`, then try again.");
      throw new Error(String(err.message ?? "CALL-E could not plan this call."));
    }
    const result = (out.result ?? {}) as Record<string, unknown>;
    const sc = (result.structuredContent ?? {}) as Record<string, unknown>;
    return {
      ready: sc.ready_to_run === true,
      questions: Array.isArray(sc.clarifying_questions) ? sc.clarifying_questions.map(String) : [],
      goal: typeof sc.display_goal === "string" ? sc.display_goal : null,
    };
  }
}

function choiceHint(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/refund|cancel/.test(t)) return "Summary mentions a refund or cancellation.";
  if (/another flight|move|reschedul|later flight|next day/.test(t)) return "Summary mentions moving to another flight.";
  if (/keep|stay on|fine with the delay|accept(ed)? the (new|delayed)/.test(t)) return "Summary mentions keeping the delayed flight.";
  return undefined;
}

/**
 * Uses the local `calle` CLI and its browser login (no API key). The MCP path has
 * no result schema, so every CLI call ends in human review with a hint.
 */
export class CliGateway implements CallGateway {
  readonly mode = "cli" as const;
  readonly live = true;
  readonly firstPollSeconds = 60;
  readonly pollSeconds = 10;

  private readonly bin: string[];
  constructor(configured?: string) {
    this.bin = resolveCalleCli(configured);
  }

  async start(request: StartRequest): Promise<StartResult> {
    let out: Record<string, unknown>;
    try {
      out = await runCli(
        this.bin,
        ["call", "start", "--to-phone", request.phone, "--goal", request.task, "--region", request.region, "--language", "English"],
        200_000,
      );
    } catch (error) {
      return { kind: "uncertain", message: error instanceof Error ? error.message : String(error) };
    }
    if (typeof out.run_id === "string") return { kind: "started", callId: out.run_id };
    const err = (out.error ?? {}) as Record<string, unknown>;
    const message = String(err.message ?? "calle call start failed");
    if (out.call_started === false) return { kind: "rejected", message };
    return {
      kind: "uncertain",
      message: `${message} The call may already be in progress. Do not start it again; follow the CLI's call recover guidance manually.`,
    };
  }

  async get(callId: string): Promise<CallOutcome> {
    const out = await runCli(this.bin, ["call", "status", "--run-id", callId], 30_000);
    const result = (out.result ?? {}) as Record<string, unknown>;
    const sc = (result.structuredContent ?? {}) as Record<string, unknown>;
    const status = String(sc.status ?? "UNKNOWN").toUpperCase();
    const state: CallOutcome["state"] =
      status === "COMPLETED" ? "completed" : CLI_TERMINAL_FAILED.has(status) ? "failed" : status === "CANCELED" || status === "CANCELLED" ? "canceled" : "in_progress";
    const summary = [sc.post_summary, sc.summary, sc.message].find((v) => typeof v === "string") as string | undefined;
    const rawTranscript = sc.transcript;
    const transcript: TranscriptTurn[] = Array.isArray(rawTranscript)
      ? rawTranscript.map((t) => {
          const turn = (t ?? {}) as Record<string, unknown>;
          return { speaker: String(turn.speaker ?? turn.role ?? ""), text: String(turn.text ?? turn.content ?? "") };
        })
      : typeof rawTranscript === "string" && rawTranscript
        ? [{ speaker: "transcript", text: rawTranscript }]
        : [];
    return {
      state,
      providerStatus: status,
      taskCompleted: null,
      confidence: null,
      result: null,
      structured: null,
      summary: summary ?? null,
      transcript,
      failureCode: state === "failed" ? status.toLowerCase() : null,
      failureMessage: null,
      hint: summary ? choiceHint(summary) : undefined,
    };
  }
}
