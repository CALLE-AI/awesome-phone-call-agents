/**
 * CALL-E integration layer: two `CalleClient` (contract) implementations plus
 * pure call-policy helpers.
 *
 *  - `RealCalleClient` wraps the `@call-e/calle` SDK, translating `RenderedCall`
 *    into the SDK's `createAndWait` and the SDK's terminal `Call` into the
 *    provider-agnostic `CallResult` the state machine consumes.
 *  - `MockCalleClient` is a deterministic, scriptable stand-in used by tests
 *    and the demo runner. It fabricates realistic transcripts and evidence and
 *    records every request for assertions. It never dials anything.
 *
 * Safety invariants honored here: phone numbers are only ever whatever the
 * (taint-checked) `RenderedCall` carries — this layer never invents or rewrites
 * a number; mock fixtures use masked +1555xxxxxxx numbers only.
 */

import {
  CalleClient as CalleSdkClient,
  CalleAPIError,
  CalleConnectionError,
  CalleTimeoutError,
  type Call,
  type CreateCallInput,
} from "@call-e/calle";
import type {
  CallOutcome,
  CallResult,
  CalleClient,
  CasePolicy,
  RenderedCall,
  TranscriptTurn,
} from "./types.js";

// ---------------------------------------------------------------------------
// Real client
// ---------------------------------------------------------------------------

/** Minimal facade over the SDK's `client.calls`, injectable for tests. */
export interface CallsApi {
  createAndWait(
    input: CreateCallInput,
    options?: { idempotencyKey?: string; intervalMs?: number; timeoutMs?: number },
  ): Promise<Call>;
}

export interface RealCalleClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Max wall-clock wait for a terminal call result. Default 15 minutes. */
  waitTimeoutMs?: number;
  /** Poll interval while waiting. SDK default when omitted. */
  pollIntervalMs?: number;
  /** Injectable calls facade (tests); when provided, apiKey/baseUrl are ignored. */
  calls?: CallsApi;
}

const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Production `CalleClient`: one `RenderedCall` in, one terminal `CallResult` out.
 *
 * Error policy: known SDK failures (API errors, connection loss, wait timeout)
 * become terminal `CallResult`s so the case runner can apply its retry ladder;
 * anything else (programmer errors) is rethrown loudly.
 */
export class RealCalleClient implements CalleClient {
  private readonly calls: CallsApi;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number | undefined;

  constructor(options: RealCalleClientOptions) {
    if (options.calls) {
      this.calls = options.calls;
    } else {
      if (!options.apiKey) {
        throw new TypeError("RealCalleClient: apiKey is required unless a calls facade is injected");
      }
      const sdk = new CalleSdkClient(
        options.baseUrl ? { apiKey: options.apiKey, baseUrl: options.baseUrl } : { apiKey: options.apiKey },
      );
      this.calls = sdk.calls;
    }
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs;
  }

  async createAndWait(req: RenderedCall): Promise<CallResult> {
    const input: CreateCallInput = {
      task: req.task,
      recipient: { phone: req.phone },
      resultSchema: req.resultSchema,
      // Correlation keys first so caller-supplied metadata wins on collision.
      metadata: { caseId: req.caseId, round: String(req.round), callee: req.callee, ...req.metadata },
    };
    const options: { idempotencyKey: string; timeoutMs: number; intervalMs?: number } = {
      idempotencyKey: req.idempotencyKey,
      timeoutMs: this.waitTimeoutMs,
    };
    if (this.pollIntervalMs !== undefined) options.intervalMs = this.pollIntervalMs;

    try {
      const call = await this.calls.createAndWait(input, options);
      return toCallResult(call);
    } catch (err) {
      // No Call object exists client-side on these paths; the idempotency key is
      // the recovery handle (re-issuing with the same key resumes the same call).
      if (err instanceof CalleTimeoutError) return unresolvedResult(req, "timed_out", err);
      if (err instanceof CalleAPIError || err instanceof CalleConnectionError) {
        return unresolvedResult(req, "failed", err);
      }
      throw err;
    }
  }
}

function unresolvedResult(req: RenderedCall, outcome: CallOutcome, err: Error): CallResult {
  return {
    callId: `unresolved:${req.idempotencyKey}`,
    outcome,
    structured: null,
    evidence: [],
    transcript: [],
    raw: { error: err.name, message: err.message },
  };
}

// Failure-code classification. The API documents failure_code as free-form
// ("machine-readable failure reason") with no published enum, so we classify
// defensively over both codes and messages, at call and attempt level.
const NO_ANSWER_RE = /no.?answer|unanswer|busy|voicemail|no.?pickup|unreach/i;
const DECLINED_RE = /declin|refus|reject|opt.?out|do.?not.?call|\bdnc\b|hung.?up|hang.?up|recipient_blocked/i;
const TIMEOUT_RE = /time.?out|timed.?out|deadline/i;

function failureText(call: Call): string {
  const parts: Array<string | null> = [call.failureCode, call.failureMessage];
  for (const recipient of call.recipients) {
    for (const attempt of recipient.attempts) {
      parts.push(attempt.failureCode, attempt.failureMessage);
    }
  }
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
}

/** Maps an SDK terminal `Call` status (+ failure codes) to the contract `CallOutcome`. */
export function mapOutcome(call: Call): CallOutcome {
  switch (call.status) {
    case "completed":
      return "completed";
    case "queued":
    case "in_progress":
      return "pending";
    case "canceled":
      return "failed";
    case "failed": {
      const text = failureText(call);
      if (NO_ANSWER_RE.test(text)) return "no_answer";
      if (DECLINED_RE.test(text)) return "declined";
      if (TIMEOUT_RE.test(text)) return "timed_out";
      return "failed";
    }
    default:
      // Future SDK statuses degrade to pending rather than fabricating a terminal state.
      return "pending";
  }
}

/**
 * Converts an SDK `Call` to the contract `CallResult`. Exported for tests.
 * The SDK keeps transcript turns in wire form (`offset_seconds`); we normalize
 * and tolerate either casing.
 */
export function toCallResult(call: Call): CallResult {
  const result: CallResult = {
    callId: call.id,
    outcome: mapOutcome(call),
    structured: call.structuredResult ?? call.recipients[0]?.structuredResult ?? null,
    evidence: [...(call.evidence ?? [])],
    transcript: flattenTranscript(call),
    raw: call,
  };
  if (call.completionConfidence) {
    result.confidence = {
      score: call.completionConfidence.score,
      label: call.completionConfidence.label,
    };
  }
  return result;
}

function flattenTranscript(call: Call): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const recipient of call.recipients) {
    for (const attempt of recipient.attempts) {
      for (const turn of attempt.transcriptTurns ?? []) {
        const raw = turn as unknown as Record<string, unknown>;
        const offset =
          typeof raw["offset_seconds"] === "number"
            ? raw["offset_seconds"]
            : typeof raw["offsetSeconds"] === "number"
              ? raw["offsetSeconds"]
              : 0;
        const speaker = raw["speaker"] === "bot" || raw["speaker"] === "user" ? raw["speaker"] : "unknown";
        turns.push({ offsetSeconds: offset, speaker, text: String(raw["text"] ?? "") });
      }
    }
  }
  return turns;
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

export type MockResponder = (req: RenderedCall) => Partial<CallResult>;

export interface MockMatcher {
  when: (req: RenderedCall) => boolean;
  respond: MockResponder;
}

/** Scripted persona: first matching matcher wins, else `default`, else a bare completed call. */
export interface MockScript {
  matchers?: MockMatcher[];
  default?: MockResponder;
}

/**
 * Deterministic scriptable client. Records every request in `.requests` for
 * assertions. Call ids are derived from an internal sequence plus the request
 * coordinates, so identical request sequences yield identical ids.
 */
export class MockCalleClient implements CalleClient {
  readonly requests: RenderedCall[] = [];
  private seq = 0;

  constructor(private readonly script: MockScript = {}) {}

  async createAndWait(req: RenderedCall): Promise<CallResult> {
    this.requests.push(req);
    this.seq += 1;
    const fallback: MockResponder = () => ({});
    const respond =
      this.script.matchers?.find((m) => m.when(req))?.respond ?? this.script.default ?? fallback;
    const partial = respond(req);
    const callId =
      partial.callId ??
      `mock_${String(this.seq).padStart(3, "0")}_${req.caseId}_r${req.round}_${req.callee}`;
    const base: CallResult = {
      callId,
      outcome: "completed",
      structured: null,
      evidence: [],
      transcript: [
        { offsetSeconds: 0, speaker: "bot", text: greeting(req) },
        { offsetSeconds: 7, speaker: "user", text: "Sure, I have a few minutes." },
      ],
      raw: { mock: true, seq: this.seq },
    };
    return { ...base, ...partial, callId };
  }
}

function greeting(req: RenderedCall): string {
  return (
    "Hi, this is the neutral Caucus mediator calling about the dispute both parties " +
    `agreed to discuss (case ${req.caseId}). Is now still an okay time?`
  );
}

// ---------------------------------------------------------------------------
// Persona building blocks
// ---------------------------------------------------------------------------

/** Classifies a rendered call by its result schema's property names. */
export function classifyCall(req: RenderedCall): "consent" | "offer" | "attestation" | "unknown" {
  const properties = (req.resultSchema as { properties?: Record<string, unknown> }).properties ?? {};
  if ("consent" in properties) return "consent";
  if ("offer_kind" in properties) return "offer";
  if ("phrase_spoken" in properties) return "attestation";
  return "unknown";
}

/**
 * 0-based per-party attempt index. Shuttle rounds alternate parties, so rounds
 * 1 and 2 are each party's first turn, 3 and 4 their second, and so on.
 */
function calleeAttemptIndex(round: number): number {
  return Math.max(0, Math.ceil(round / 2) - 1);
}

const AMOUNT_RE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s+dollars/gi;
const RELAY_CONTEXT_RE = /offer|propos|counter|willing|accept|settle\s+for/i;

/**
 * Heuristic (mock-only): extract the dollar amount being relayed to the callee
 * from the rendered task text. Only amounts whose preceding ~60 characters
 * contain relay language ("offered", "proposes", "would you accept", ...) count,
 * so a dispute total mentioned in the summary is not mistaken for an offer.
 * Returns the last such amount, or null.
 */
export function extractRelayedDollars(task: string): number | null {
  let relayed: number | null = null;
  for (const match of task.matchAll(AMOUNT_RE)) {
    const digits = match[1] ?? match[2];
    const index = match.index ?? 0;
    if (digits === undefined) continue;
    const preceding = task.slice(Math.max(0, index - 60), index);
    if (!RELAY_CONTEXT_RE.test(preceding)) continue;
    const value = Number(digits.replaceAll(",", ""));
    if (Number.isFinite(value)) relayed = value;
  }
  return relayed;
}

function dollars(amount: number): string {
  return `$${amount % 1 === 0 ? amount : amount.toFixed(2)}`;
}

function consentResponse(consent: "yes" | "no", concerns: string, userLine: string): Partial<CallResult> {
  return {
    outcome: "completed",
    structured: { consent, concerns },
    confidence: { score: 0.93, label: "high" },
    evidence: [userLine],
    transcript: [
      {
        offsetSeconds: 0,
        speaker: "bot",
        text:
          "Hi, this is the neutral Caucus mediator. Both parties suggested a mediated settlement " +
          "over the phone. Do you consent to participate in these calls? I only relay what each " +
          "side approves for sharing — I never advise either side.",
      },
      { offsetSeconds: 11, speaker: "user", text: userLine },
      { offsetSeconds: 16, speaker: "bot", text: "Understood — I have noted that, word for word." },
    ],
  };
}

function offerResponse(
  kind: "open" | "counter" | "accept" | "reject",
  amountDollars: number,
  conditions: string[],
  publicRationale: string,
  quote: string,
): Partial<CallResult> {
  return {
    outcome: "completed",
    structured: {
      offer_kind: kind,
      amount_dollars: amountDollars,
      conditions,
      public_rationale: publicRationale,
      verbatim_quote: quote,
    },
    confidence: { score: 0.9, label: "high" },
    evidence: [quote],
    transcript: [
      {
        offsetSeconds: 0,
        speaker: "bot",
        text: "This is the Caucus mediator with the latest from the other side. I will relay only what you approve.",
      },
      { offsetSeconds: 9, speaker: "user", text: quote },
      {
        offsetSeconds: 15,
        speaker: "bot",
        text: "Got it. I will convey exactly that and nothing else you have told me.",
      },
    ],
  };
}

/**
 * The attestation phrase, anchored to the renderer's "word for word:" lead-in.
 *
 * Anchoring is required, not cosmetic: an attestation task also quotes the
 * settlement conditions verbatim, and those quotes appear BEFORE the phrase.
 * A regex that took the first quoted run in the task would echo a condition
 * instead of the phrase, and attestation would fail for a reason that looks
 * like a production bug but is really a mis-scripted mock.
 */
const ATTESTATION_PHRASE_RE = /word for word:\s*(?:"([^"]+)"|“([^”]+)”|'([^']+)')/i;

function attestationResponse(req: RenderedCall, agrees: "yes" | "no"): Partial<CallResult> {
  const match = ATTESTATION_PHRASE_RE.exec(req.task);
  const phrase = match?.[1] ?? match?.[2] ?? match?.[3];
  // Fail loudly rather than echoing a plausible-but-wrong default: a silent
  // wrong phrase would make a scripting error masquerade as a failed attestation.
  if (phrase === undefined) {
    throw new Error(
      "MockCalleClient: attestation task carries no quoted confirmation phrase; " +
        "the persona cannot know what to echo. Task began: " +
        JSON.stringify(req.task.slice(0, 120)),
    );
  }
  return {
    outcome: "completed",
    structured: { phrase_spoken: phrase, agrees_to_terms: agrees },
    confidence: { score: 0.95, label: "high" },
    evidence: [phrase],
    transcript: [
      {
        offsetSeconds: 0,
        speaker: "bot",
        text: "I will read the settlement terms back, then ask you to repeat the attestation phrase exactly.",
      },
      { offsetSeconds: 12, speaker: "user", text: phrase },
      {
        offsetSeconds: 16,
        speaker: "user",
        text: agrees === "yes" ? "Yes, I agree to those terms." : "No, that is not what I agreed to.",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Prebuilt personas
// ---------------------------------------------------------------------------

/**
 * Party who owes money (e.g. a landlord holding a deposit). Consents, opens at
 * `openDollars`, raises ~$100 per own round up to `acceptCeilingDollars`, and
 * accepts any relayed proposal at or below that ceiling. Attests happily.
 */
export function agreeableLandlord(openDollars = 400, acceptCeilingDollars = 700): MockScript {
  return {
    default: (req) => {
      switch (classifyCall(req)) {
        case "consent":
          return consentResponse(
            "yes",
            "Wants this settled without small-claims court.",
            "Yes, I agree to take these calls. I'd rather settle than go to court.",
          );
        case "attestation":
          return attestationResponse(req, "yes");
        case "offer": {
          const relayed = extractRelayedDollars(req.task);
          if (relayed !== null && relayed <= acceptCeilingDollars) {
            return offerResponse(
              "accept",
              relayed,
              [],
              "Wants the matter closed this week.",
              `Fine — I accept ${dollars(relayed)}, let's be done with it.`,
            );
          }
          const attempt = calleeAttemptIndex(req.round);
          const amount = Math.min(acceptCeilingDollars, openDollars + 100 * attempt);
          const kind = relayed === null && attempt === 0 ? "open" : "counter";
          return offerResponse(
            kind,
            amount,
            ["tenant returns both mailbox keys"],
            "The carpet replacement had a real cost.",
            `The most I can do right now is ${dollars(amount)}.`,
          );
        }
        default:
          return {};
      }
    },
  };
}

/**
 * Party owed money (e.g. a tenant reclaiming a deposit). Opens at the full
 * amount and concedes ~20% per own round; accepts a relayed proposal only once
 * it is at least as good as their own next concession would be.
 */
export function stubbornTenant(fullAmountDollars = 1200): MockScript {
  return {
    default: (req) => {
      switch (classifyCall(req)) {
        case "consent":
          return consentResponse(
            "yes",
            "Wants the landlord to stop texting about it in the meantime.",
            "Yes, I consent to the mediation calls — I just want my deposit back.",
          );
        case "attestation":
          return attestationResponse(req, "yes");
        case "offer": {
          const attempt = calleeAttemptIndex(req.round);
          const demand = Math.round(fullAmountDollars * 0.8 ** attempt);
          const nextConcession = Math.round(fullAmountDollars * 0.8 ** (attempt + 1));
          const relayed = extractRelayedDollars(req.task);
          if (relayed !== null && relayed >= nextConcession) {
            return offerResponse(
              "accept",
              relayed,
              [],
              "Tired of arguing; the amount is close enough.",
              `Okay. If it's ${dollars(relayed)}, I'll accept that.`,
            );
          }
          const kind = relayed === null && attempt === 0 ? "open" : "counter";
          return offerResponse(
            kind,
            demand,
            ["landlord provides an itemized deduction list"],
            "The unit was left clean and photographed.",
            `I want ${dollars(demand)} back — I have photos of how clean I left it.`,
          );
        }
        default:
          return {};
      }
    },
  };
}

/** Never picks up: every call is a `no_answer` with no transcript. */
export function noAnswerPersona(): MockScript {
  return {
    default: () => ({
      outcome: "no_answer",
      structured: null,
      evidence: [],
      transcript: [],
    }),
  };
}

/**
 * Answers but wants out. Consent calls complete with an explicit "no" (which
 * must route the case to declined_consent); any other call is declined outright.
 */
export function decliningPersona(): MockScript {
  return {
    default: (req) => {
      if (classifyCall(req) === "consent") {
        return consentResponse(
          "no",
          "Does not want to discuss this dispute by phone.",
          "No. I don't consent to any calls about this.",
        );
      }
      return {
        outcome: "declined",
        structured: null,
        evidence: [],
        transcript: [
          { offsetSeconds: 0, speaker: "bot", text: greeting(req) },
          { offsetSeconds: 6, speaker: "user", text: "Please don't call me about this again." },
        ],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Call-policy helpers (pure)
// ---------------------------------------------------------------------------

function assertValidIso(iso: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`invalid ISO timestamp: ${JSON.stringify(iso)}`);
  }
  return date;
}

function localHour(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value;
  const value = Number(hour);
  if (!Number.isInteger(value)) {
    throw new RangeError(`could not resolve local hour for timezone ${JSON.stringify(timeZone)}`);
  }
  return value;
}

/**
 * True when `nowIso` falls inside the policy's quiet-hours window
 * [startHour, endHour) in the callee's local timezone. `timezone` overrides
 * `policy.callWindow.timezone` (per-callee zones). Windows may cross midnight
 * (start > end); start === end is a degenerate empty window (always false).
 */
export function withinCallWindow(policy: CasePolicy, nowIso: string, timezone?: string): boolean {
  const { startHour, endHour } = policy.callWindow;
  if (startHour === endHour) return false;
  const hour = localHour(assertValidIso(nowIso), timezone ?? policy.callWindow.timezone);
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/**
 * ISO timestamp of the next retry after failed attempt `attemptIndex` (0-based),
 * per the policy's retry ladder; null when the ladder is exhausted.
 */
export function nextRetryAt(policy: CasePolicy, attemptIndex: number, nowIso: string): string | null {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    throw new RangeError(`attemptIndex must be a non-negative integer, got ${attemptIndex}`);
  }
  const delayMinutes = policy.retryDelaysMinutes[attemptIndex];
  if (delayMinutes === undefined) return null;
  const now = assertValidIso(nowIso);
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}
