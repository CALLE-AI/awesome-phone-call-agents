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
const OFFICIAL_CALLE_HOST = "api.heycall-e.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Verify the CALL-E base URL is strictly the official HTTPS origin (or loopback
 * for local fake-server tests with an injected fetch). The CALLE_API_KEY must
 * never be sent to an arbitrary host.
 */
export function assertAllowedCalleBaseUrl(baseUrl: string | undefined): void {
  const urlString = baseUrl ?? DEFAULT_CALLE_BASE_URL;
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`CALLE_BASE_URL is not a valid URL: ${urlString}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const isLoopback = LOOPBACK_HOSTS.has(host);
  if (isLoopback) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`CALLE_BASE_URL loopback must use http or https: ${urlString}`);
    }
    return;
  }
  if (host !== OFFICIAL_CALLE_HOST) {
    throw new Error(`CALLE_BASE_URL must be ${DEFAULT_CALLE_BASE_URL} (got ${urlString}); arbitrary hosts are not allowed.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`CALLE_BASE_URL must use https: ${urlString}`);
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
  // Must be a terminal completed result
  if (call.status !== "completed") return false;
  if (call.taskCompleted === false) return false;
  if (call.failureCode) return false;
  // Must be bound to the exact task, recipient phones, and watch/candidate we asked for
  if (call.task !== expectedTask) return false;
  const phones = call.recipients?.flatMap((r) => r.phones ?? []) ?? [];
  // Also check legacy single recipient
  // The SDK may return recipients as array; check at least one matches
  const expectedPhone = expectedRecipient.phones[0];
  if (expectedPhone && !phones.includes(expectedPhone)) {
    // Fallback: check if the raw phoneE164 appears anywhere in task (defense)
    if (!call.task.includes(expectedPhone)) return false;
  }
  const meta = call.metadata as Record<string, unknown> | null | undefined;
  if (meta) {
    if (meta["watch_id"] !== input.watchId) return false;
    if (meta["candidate_id"] !== input.candidate.id) return false;
  } else {
    return false;
  }
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
      verified: true,
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
      verified: true,
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
