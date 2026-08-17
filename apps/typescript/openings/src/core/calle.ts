import { CalleClient, type Call } from "@call-e/calle";
import { CALL_E_RESULT_SCHEMA, parseStructuredResult } from "./schema";
import type { CallStructuredResult, Candidate, SearchSpec } from "./types";

export type CallMode = "live" | "dry-run" | "fake";

export interface PlaceCallInput {
  candidate: Candidate;
  spec: SearchSpec;
  idempotencyKey: string;
  /** Watch id recorded on the CALL-E-side metadata for traceability. */
  watchId: string;
}

export interface PlaceCallOutput {
  callId?: string;
  /** Raw structured result parsed to a typed value, or null when invalid. */
  result: CallStructuredResult | null;
  /** Raw evidence array from CALL-E, when available. */
  evidence: string[];
  /** CALL-E's own post-call summary, when available. Rich signal for retry. */
  summary?: string;
  completed: boolean;
  simulated: boolean;
  calleStatus?: string;
}

/**
 * Build the natural-language task CALL-E is asked to execute. The task is
 * deliberately narrow: plan acceptance + availability + disclosure. No PHI.
 */
export function buildTask(candidate: Candidate, spec: SearchSpec): string {
  const name = candidate.name ? ` for ${candidate.name}` : "";
  const location = candidate.address ?? [candidate.city, candidate.state].filter(Boolean).join(", ");
  const modality =
    spec.modality === "either" ? "in-person or telehealth" : spec.modality === "in_person" ? "in-person" : "telehealth";
  return [
    `Call ${candidate.phoneE164}${name} (directory listing ${location || "location unknown"}).`,
    "Start by identifying as an automated assistant.",
    `Ask whether the practice accepts the "${spec.plan}" insurance plan and whether they are accepting new patients for ${spec.need.toLowerCase()}.`,
    `Ask what the soonest ${modality} appointment is.`,
    "If a person is not reached, note that fact. Do not book, cancel, or promise anything on the caller's behalf.",
  ].join(" ");
}

function recipientFor(candidate: Candidate): { phones: string[]; region?: string; locale?: string } {
  return { phones: [candidate.phoneE164], region: "US", locale: "en-US" };
}

/**
 * Live caller against the CALL-E Developer API. Uses the published SDK and a
 * stable idempotency key. The SDK accepts an injected fetch for tests.
 */
export class LiveCaller {
  private readonly client: CalleClient;

  constructor(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    this.client = new CalleClient({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async placeCall(input: PlaceCallInput): Promise<PlaceCallOutput> {
    const call = await this.client.calls.createAndWait(
      {
        task: buildTask(input.candidate, input.spec),
        recipient: recipientFor(input.candidate),
        resultSchema: CALL_E_RESULT_SCHEMA,
        metadata: {
          watch_id: input.watchId,
          candidate_id: input.candidate.id,
          idempotency_key: input.idempotencyKey,
        },
      },
      {
        idempotencyKey: input.idempotencyKey,
        // Live calls can spend minutes in IVR/hold. Default 120s is too short.
        timeoutMs: 6 * 60_000,
        intervalMs: 5_000,
      },
    );
    return toOutput(call);
  }
}

function toOutput(call: Call): PlaceCallOutput {
  const result = parseStructuredResult(call.structuredResult);
  return {
    callId: call.id,
    result,
    evidence: call.evidence ?? [],
    summary: call.summary ?? undefined,
    completed: call.status === "completed",
    simulated: false,
    calleStatus: call.status,
  };
}

/**
 * Dry-run caller. Returns a deterministic, simulated outcome without dialing.
 * Used for previews and for reviewers who have no credentials.
 */
export class DryRunCaller {
  async placeCall(input: PlaceCallInput): Promise<PlaceCallOutput> {
    const simulated: CallStructuredResult = {
      line_outcome: "reached_staff",
      accepts_plan: "yes",
      accepting_new_patients: "yes",
      soonest_appointment_stated: "this week",
      wait_estimate_days: 4,
      modality: "both",
      evidence_quote: `[simulated] ${input.candidate.name || "Practice"} confirmed availability.`,
    };
    return {
      result: simulated,
      evidence: [simulated.evidence_quote],
      completed: true,
      simulated: true,
    };
  }
}

/**
 * Fake caller for tests. Deterministic per candidate id, no network, no
 * credentials. Mode is forced to fake by the test environment.
 */
export class FakeCaller {
  private readonly seed: Map<string, CallStructuredResult>;

  constructor(results?: Array<{ candidateId: string; result: CallStructuredResult }>) {
    this.seed = new Map((results ?? []).map((r) => [r.candidateId, r.result]));
  }

  async placeCall(input: PlaceCallInput): Promise<PlaceCallOutput> {
    const result =
      this.seed.get(input.candidate.id) ??
      ({
        line_outcome: "voicemail",
        accepts_plan: "unknown",
        accepting_new_patients: "unknown",
        soonest_appointment_stated: "",
        wait_estimate_days: -1,
        modality: "unknown",
        evidence_quote: "[fake] voicemail; no answer.",
      } satisfies CallStructuredResult);
    return {
      callId: `fake-${input.candidate.id}`,
      result,
      evidence: [result.evidence_quote],
      completed: true,
      simulated: true,
      calleStatus: "completed",
    };
  }
}

export function makeCaller(mode: CallMode, options?: { apiKey?: string; baseUrl?: string }): Caller {
  switch (mode) {
    case "live":
      if (!options?.apiKey) {
        throw new Error("LIVE mode requires CALLE_API_KEY");
      }
      return new LiveCaller({ apiKey: options.apiKey, baseUrl: options.baseUrl });
    case "dry-run":
      return new DryRunCaller();
    case "fake":
      return new FakeCaller();
  }
}

export type Caller = { placeCall(input: PlaceCallInput): Promise<PlaceCallOutput> };
