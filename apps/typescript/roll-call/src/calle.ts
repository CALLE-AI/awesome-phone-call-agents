import { CalleClient } from "@call-e/calle";
import type { CallExtraction, CallOutcome, CallStatus, TranscriptTurn } from "./types.js";

export interface PlaceCallRequest {
  task: string;
  phone: string;
  locale: string;
  region: string;
  resultSchema: Record<string, unknown>;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

/** The only seam between Roll Call and the phone network. */
export interface CallPlacer {
  readonly mode: "dry-run" | "live";
  place(request: PlaceCallRequest): Promise<CallOutcome>;
}

/**
 * Dry run: builds the exact request CALL-E would receive and returns a
 * terminal outcome that says no call was placed. The default everywhere.
 */
export class DryRunPlacer implements CallPlacer {
  readonly mode = "dry-run" as const;
  readonly requests: PlaceCallRequest[] = [];

  async place(request: PlaceCallRequest): Promise<CallOutcome> {
    this.requests.push(request);
    return {
      callId: `dryrun_${request.idempotencyKey}`,
      status: "completed",
      structuredResult: null,
      summary: "dry run — no call was placed",
      transcript: [],
      failureCode: null,
      failureMessage: null,
    };
  }
}

const EXTRACTION_KEYS: (keyof CallExtraction)[] = [
  "answered_by",
  "guardian_aware",
  "reason_category",
  "expected_return",
  "callback_requested",
  "guardian_words",
];

/** Accepts only an object with exactly the schema's keys; anything else is null. */
export function asExtraction(value: unknown): CallExtraction | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  for (const key of EXTRACTION_KEYS) {
    if (typeof o[key] !== "string") return null;
  }
  return o as unknown as CallExtraction;
}

export interface LivePlacerOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: (input: Request) => Promise<Response>;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Live: one CALL-E call task per guardian, one recipient each, so the
 * cascade is sequential and stops the moment a guardian is reached.
 */
export class LivePlacer implements CallPlacer {
  readonly mode = "live" as const;
  private readonly client: CalleClient;
  private readonly timeoutMs: number;
  private readonly intervalMs: number;

  constructor(options: LivePlacerOptions) {
    this.client = new CalleClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
    });
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.intervalMs = options.intervalMs ?? 3_000;
  }

  async place(request: PlaceCallRequest): Promise<CallOutcome> {
    const created = await this.client.calls.create(
      {
        task: request.task,
        recipients: [{ phones: [request.phone], locale: request.locale, region: request.region }],
        resultSchema: request.resultSchema,
        metadata: request.metadata,
      },
      { idempotencyKey: request.idempotencyKey },
    );
    const call = await this.client.calls.waitForResult(created.id, {
      timeoutMs: this.timeoutMs,
      intervalMs: this.intervalMs,
    });
    const attempts = call.recipients.flatMap((r) => r.attempts);
    const transcript: TranscriptTurn[] = attempts.flatMap((a) =>
      a.transcriptTurns.map((t) => ({
        offset_seconds: t.offset_seconds ?? 0,
        speaker: t.speaker,
        text: t.text,
      })),
    );
    const lastAttempt = attempts.at(-1);
    return {
      callId: call.id,
      status: call.status as CallStatus,
      structuredResult: asExtraction(call.structuredResult),
      summary: call.summary ?? null,
      transcript,
      failureCode: call.failureCode ?? lastAttempt?.failureCode ?? null,
      failureMessage: call.failureMessage ?? lastAttempt?.failureMessage ?? null,
    };
  }
}
