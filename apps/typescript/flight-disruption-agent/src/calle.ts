import { execFile } from "node:child_process";
import {
  CalleAPIError,
  CalleClient,
  type Call,
} from "@call-e/calle";
import type { Booking, CallOutcome, PassengerResult, Quote, TranscriptTurn } from "./types.ts";

export interface StartRequest {
  task: string;
  phone: string;
  region: string;
  locale: string;
  resultSchema: Record<string, unknown>;
  metadata: Record<string, string>;
  idempotencyKey: string;
  /** Dry-run only. */
  booking: Booking;
  quote: Quote;
}

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
    return scriptedOutcome(call.request.booking, call.request.quote);
  }
}

function scriptedOutcome(booking: Booking, quote: Quote): CallOutcome {
  const name = booking.passenger.split(" ")[0];
  const opening: TranscriptTurn[] = [
    { speaker: "bot", text: `Hi, this is an AI assistant calling for TripKita. May I speak with ${booking.passenger}?`, offsetSeconds: 0 },
    { speaker: "user", text: "Speaking.", offsetSeconds: 4 },
    { speaker: "bot", text: "Your flight is delayed. You can keep the new time, move to another flight, or cancel for a refund.", offsetSeconds: 7 },
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

function runCli(bin: string, args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      const start = stdout.indexOf("{");
      if (start === -1) {
        reject(error ?? new Error("calle CLI returned no JSON"));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(start)) as Record<string, unknown>);
      } catch {
        reject(error ?? new Error("calle CLI returned invalid JSON"));
      }
    });
  });
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

  constructor(private readonly bin = "calle") {}

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
