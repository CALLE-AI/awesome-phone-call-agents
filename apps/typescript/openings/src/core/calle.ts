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
  /** True only for a terminal completed live result bound to the exact task/recipient/watch. */
  verified: boolean;
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

export const DEFAULT_CALLE_BASE_URL = "https://api.heycall-e.com";
const OFFICIAL_CALLE_ORIGIN = "https://api.heycall-e.com";

/**
 * Verify the CALL-E base URL is exactly the official HTTPS origin.
 * The CALLE_API_KEY must never be sent anywhere else, so the comparison is on
 * the full origin (scheme + host + port) and any path/query/hash is rejected:
 * `https://api.heycall-e.com.evil.test`, port variants like
 * `https://api.heycall-e.com:8443`, and paths like
 * `https://api.heycall-e.com/proxy` are all refused.
 */
export function assertAllowedCalleBaseUrl(baseUrl: string | undefined): void {
  const urlString = baseUrl ?? DEFAULT_CALLE_BASE_URL;
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`CALLE_BASE_URL is not a valid URL: ${urlString}`);
  }
  const origin = `${url.protocol}//${url.host}`;
  if (origin !== OFFICIAL_CALLE_ORIGIN) {
    throw new Error(
      `CALLE_BASE_URL must be exactly ${OFFICIAL_CALLE_ORIGIN} (got ${urlString}); other origins, ports, or paths are not allowed.`,
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(
      `CALLE_BASE_URL must not include a path (got ${urlString}); use exactly ${OFFICIAL_CALLE_ORIGIN}.`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(`CALLE_BASE_URL must not include a query or fragment (got ${urlString}).`);
  }
}

/**
 * Live caller against the CALL-E Developer API. Uses the published SDK and a
 * stable idempotency key. The SDK accepts an injected fetch for tests.
 */
export class LiveCaller {
  private readonly client: CalleClient;

  constructor(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch }) {
    assertAllowedCalleBaseUrl(options.baseUrl);
    this.client = new CalleClient({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  async placeCall(input: PlaceCallInput): Promise<PlaceCallOutput> {
    const expectedTask = buildTask(input.candidate, input.spec);
    const expectedRecipient = recipientFor(input.candidate);
    const call = await this.client.calls.createAndWait(
      {
        task: expectedTask,
        recipient: expectedRecipient,
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
    return toOutput(call, input, expectedTask, expectedRecipient);
  }
}

function isVerifiedCall(
  call: Call,
  input: PlaceCallInput,
  expectedTask: string,
  expectedRecipient: { phones: string[] },
): boolean {
  // Must be a terminal completed result with the task explicitly done.
  if (call.status !== "completed") return false;
  if (call.taskCompleted !== true) return false;
  if (call.failureCode) return false;
  // Must be bound to the exact task we asked for.
  if (call.task !== expectedTask) return false;
  // The provider's returned recipient list must contain the dialed number.
  // No fallback to matching the task text: a missing or mismatched provider
  // recipient means this result cannot be attributed to our call.
  const expectedPhone = expectedRecipient.phones[0];
  const phones = (call.recipients ?? []).flatMap((r) => r.phones ?? []);
  if (!expectedPhone || !phones.includes(expectedPhone)) return false;
  // Metadata must bind the result to this watch and candidate.
  const meta = call.metadata as Record<string, unknown> | null | undefined;
  if (!meta) return false;
  if (meta["watch_id"] !== input.watchId) return false;
  if (meta["candidate_id"] !== input.candidate.id) return false;
  // Must have a call id
  if (!call.id) return false;
  return true;
}

function toOutput(
  call: Call,
  input?: PlaceCallInput,
  expectedTask?: string,
  expectedRecipient?: { phones: string[] },
): PlaceCallOutput {
  const result = parseStructuredResult(call.structuredResult);
  const completed = call.status === "completed";
  let verified = false;
  if (input && expectedTask && expectedRecipient) {
    verified = isVerifiedCall(call, input, expectedTask, expectedRecipient) && result !== null && completed;
  } else {
    // For calls where we don't have input context (should not happen for live), treat as unverified
    verified = false;
  }
  return {
    callId: call.id,
    result,
    evidence: call.evidence ?? [],
    summary: call.summary ?? undefined,
    completed,
    simulated: false,
    calleStatus: call.status,
    verified,
  };
}

/**
 * Dry-run caller. Returns a deterministic, simulated outcome without dialing.
 * Used for previews and for reviewers who have no credentials.
 *
 * `verified` is false by design: nothing was dialed, so the result is a
 * simulation, never provider-verified evidence.
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
      verified: false,
      calleStatus: "completed",
    };
  }
}

/**
 * Fake caller for tests. Deterministic per candidate id, no network, no
 * credentials. Mode is forced to fake by the test environment.
 *
 * `verified` is false by design: tests exercise the fail-closed path, so a
 * simulated result must never count as provider-verified evidence.
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
      verified: false,
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
      assertAllowedCalleBaseUrl(options.baseUrl);
      return new LiveCaller({ apiKey: options.apiKey, baseUrl: options.baseUrl });
    case "dry-run":
      return new DryRunCaller();
    case "fake":
      return new FakeCaller();
  }
}

export type Caller = { placeCall(input: PlaceCallInput): Promise<PlaceCallOutput> };
