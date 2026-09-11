import type { Call, CalleClient, JsonObject } from "@call-e/calle";
import type { Stop, Truth } from "../core/types.js";
import { READINESS_SCHEMA } from "./task.js";

export interface LiveLine {
  /** Minute after shift start when the line was seen. */
  at: number;
  speaker: "bot" | "customer" | "system";
  text: string;
  /**
   * How the line joins the previous line from the same speaker: CALL-E streams
   * bot speech as sentence chunks and customer speech as growing partial transcripts.
   */
  merge?: "append" | "replace";
}

export interface CallRequest {
  stopId: string;
  phone: string;
  region: string;
  locale?: string;
  task: string;
  /** Minutes until the rider arrives, as told to the customer. */
  etaMinutes: number;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

/** One phone line. start() places a call; poll() returns new transcript lines and, once finished, the final call. */
export interface CallPort {
  readonly mode: "scripted" | "live";
  start(request: CallRequest, now: number): Promise<{ callId: string }>;
  poll(callId: string, now: number): Promise<{ lines: LiveLine[]; final: Call | null }>;
}

const TERMINAL = new Set(["completed", "failed", "canceled"]);

/** Places real calls through the CALL-E SDK. */
export class LivePort implements CallPort {
  readonly mode = "live" as const;
  static readonly EVENT_PAGE_SIZE = 100;
  /** Most event pages read in one status check, so a check can never stall the day. */
  static readonly MAX_EVENT_PAGES = 5;
  private readonly seen = new Map<string, Set<string>>();
  private readonly lastLine = new Map<string, LiveLine>();
  private readonly polledAt = new Map<string, number>();

  /** @param pollIntervalMs minimum real time between status checks for one call */
  constructor(
    private readonly client: CalleClient,
    private readonly pollIntervalMs = 2500,
  ) {}

  async start(request: CallRequest): Promise<{ callId: string }> {
    const call = await this.client.calls.create(
      {
        task: request.task,
        recipient: { phone: request.phone, region: request.region, ...(request.locale ? { locale: request.locale } : {}) },
        recipientResultSchema: READINESS_SCHEMA,
        metadata: request.metadata,
      },
      { idempotencyKey: request.idempotencyKey },
    );
    return { callId: call.id };
  }

  async poll(callId: string, now: number): Promise<{ lines: LiveLine[]; final: Call | null }> {
    if (Date.now() - (this.polledAt.get(callId) ?? 0) < this.pollIntervalMs) return { lines: [], final: null };
    this.polledAt.set(callId, Date.now());
    const call = await this.client.calls.get(callId);
    const seen = this.seen.get(callId) ?? new Set<string>();
    this.seen.set(callId, seen);
    const lines: LiveLine[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < LivePort.MAX_EVENT_PAGES; pageNumber++) {
      const page = await this.client.calls.listEvents(callId, { limit: LivePort.EVENT_PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      for (const event of page.data) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        const line = toLine(event.message, now);
        if (!line) continue;
        const previous = this.lastLine.get(callId);
        if (previous && previous.speaker === line.speaker && line.speaker !== "system") {
          line.merge = line.speaker === "customer" ? "replace" : "append";
        }
        this.lastLine.set(callId, line);
        lines.push(line);
      }
      // A short page is the end for now: while a call is live the API can keep
      // returning a cursor for events that do not exist yet.
      const full = page.data.length === LivePort.EVENT_PAGE_SIZE;
      if (!full || !page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return { lines, final: TERMINAL.has(call.status) ? call : null };
  }
}

const SPEAKER_PREFIXES: [string, LiveLine["speaker"]][] = [
  ["Bot is speaking: ", "bot"],
  ["Callee said: ", "customer"],
];
const SYSTEM_MESSAGES = new Set(["Call is ringing.", "Call connected."]);

/** Maps a CALL-E event message to a transcript line; internal progress messages are dropped. */
export function toLine(message: string, now: number): LiveLine | null {
  for (const [prefix, speaker] of SPEAKER_PREFIXES) {
    if (message.startsWith(prefix)) return { at: now, speaker, text: message.slice(prefix.length).trim() };
  }
  return SYSTEM_MESSAGES.has(message) ? { at: now, speaker: "system", text: message } : null;
}

/** Scripted calls answered from the fixture's ground truth; never touches the network. */
export class ScriptedPort implements CallPort {
  readonly mode = "scripted" as const;
  static readonly CALL_MINUTES = 2;
  private readonly calls = new Map<string, { request: CallRequest; truth: Truth; startedAt: number; delivered: number }>();

  constructor(
    private readonly stops: Map<string, Stop>,
    private readonly truth: Record<string, Truth>,
    private readonly merchant: string,
  ) {}

  async start(request: CallRequest, now: number): Promise<{ callId: string }> {
    const truth = this.truth[request.stopId];
    if (!truth || !this.stops.has(request.stopId)) throw new Error(`No scripted customer for ${request.stopId}`);
    const callId = `sim_${request.stopId}`;
    this.calls.set(callId, { request, truth, startedAt: now, delivered: 0 });
    return { callId };
  }

  async poll(callId: string, now: number): Promise<{ lines: LiveLine[]; final: Call | null }> {
    const call = this.calls.get(callId);
    if (!call) throw new Error(`Unknown scripted call ${callId}`);
    const elapsed = now - call.startedAt;
    const due = this.script(call.request, call.truth).filter((line) => line.offset <= elapsed);
    const lines = due.slice(call.delivered).map(({ offset, speaker, text }) => ({ at: call.startedAt + offset, speaker, text }));
    call.delivered = due.length;
    return { lines, final: elapsed >= ScriptedPort.CALL_MINUTES ? scriptedResult(callId, call.request, call.truth) : null };
  }

  private script(request: CallRequest, truth: Truth): { offset: number; speaker: LiveLine["speaker"]; text: string }[] {
    if (truth.reached !== "yes") {
      return [
        { offset: 0.3, speaker: "system", text: "Call is ringing." },
        { offset: 1.8, speaker: "system", text: "No answer." },
      ];
    }
    const opening: { offset: number; speaker: LiveLine["speaker"]; text: string }[] = [
      { offset: 0.3, speaker: "system", text: "Call connected." },
      {
        offset: 0.4,
        speaker: "bot",
        text: `Hello, I'm an AI assistant calling from ${this.merchant} about your delivery. The rider should reach you in about ${Math.round(request.etaMinutes)} minutes. Can you receive it then?`,
      },
      { offset: 0.9, speaker: "customer", text: truth.quote },
    ];
    if (truth.readiness === "later_today" || truth.readiness === "not_today") {
      return [...opening, { offset: 1.4, speaker: "bot", text: "Understood, thank you. We will arrange another time with you." }];
    }
    return [
      ...opening,
      { offset: 1.3, speaker: "bot", text: "Thank you. Is there a landmark that helps the rider find your door?" },
      { offset: 1.6, speaker: "customer", text: truth.landmark || "No, the address is enough." },
      { offset: 1.9, speaker: "bot", text: "Thank you, goodbye." },
    ];
  }
}

function scriptedResult(callId: string, request: CallRequest, truth: Truth): Call {
  const reached = truth.reached === "yes";
  const answer = {
    reached_recipient: "yes",
    readiness: truth.readiness,
    ready_clock_time: truth.readyClock,
    handoff: truth.handoff,
    cod_cash_ready: truth.cash,
    landmark: truth.landmark,
    customer_quote: truth.quote,
    quote_in_english: truth.quote,
  };
  return {
    id: callId,
    object: "call_task",
    status: reached ? "completed" : "failed",
    task: request.task,
    recipients: [
      {
        id: `rcp_${callId}`,
        phones: [request.phone],
        locale: request.locale ?? null,
        region: request.region,
        status: reached ? "completed" : "failed",
        structuredResult: reached ? (answer as JsonObject) : null,
        summary: null,
        attempts: [],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: reached,
    completionConfidence: reached ? { score: 0.9, label: "high" } : null,
    evidence: reached ? [truth.quote] : [],
    metadata: request.metadata,
    failureCode: reached ? null : "no_answer",
    failureMessage: reached ? null : "The customer did not answer.",
    createdAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
  };
}
