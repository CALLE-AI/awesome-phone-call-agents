/**
 * Real CALL-E Developer API adapter.
 *
 * Every network operation is fail-closed behind an official HTTPS origin,
 * SPIKE_LIVE, a named experiment confirmation and an explicit positive budget.
 * The adapter intentionally declares provider idempotency as unverified until
 * Phase-0 S4/S5 evidence proves the guarantee, so the dispatcher will not
 * retry an ambiguous create through this adapter.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BusinessOutcome, CanonicalCallPayload } from "../runtime/types.js";
import { isGlobalStopActive } from "../runtime/global-stop.js";
import type { CalleAdapter, CalleCreateResult, CallePollResult } from "./types.js";

const OFFICIAL_ORIGIN = "https://api.heycall-e.com";
type Json = Record<string, unknown>;

function asJson(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function confirmationTokenFor(experimentId: string): string {
  return `CONFIRM_${experimentId}_ONE_ALLOWLISTED_CALL`;
}

function mapProviderState(status: string): CallePollResult["provider_state"] {
  const normalized = status.toLowerCase();
  if (normalized.includes("ring")) return "ringing";
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  if (
    normalized.includes("complete") ||
    normalized.includes("done") ||
    normalized.includes("ended")
  ) {
    return "completed";
  }
  if (
    normalized.includes("accept") ||
    normalized.includes("queue") ||
    normalized.includes("creat")
  ) {
    return "accepted";
  }
  return "unknown";
}

function mapPollStatus(status: string): CallePollResult["status"] {
  const normalized = status.toLowerCase();
  if (normalized.includes("ring")) return "ringing";
  if (
    normalized.includes("progress") ||
    normalized.includes("active") ||
    normalized.includes("connect")
  ) {
    return "in_progress";
  }
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  if (
    normalized.includes("complete") ||
    normalized.includes("done") ||
    normalized.includes("ended")
  ) {
    return "completed";
  }
  return "queued";
}

function deriveBusinessOutcome(structured: Json | null): BusinessOutcome | null {
  if (!structured) return null;
  const value =
    structured.acceptance ??
    structured.good_time ??
    structured.can_attend ??
    structured.confirmed ??
    structured.reached;
  if (value === "declined" || value === "no") return "declined";
  if (value === "candidate_accepted" || value === "yes") {
    return "candidate_accepted";
  }
  if (value === "practice_acknowledged") return "practice_acknowledged";
  if (value === "verbally_confirmed") return "verbally_confirmed";
  if (value === "no_answer") return "no_answer";
  if (value === "voicemail") return "voicemail";
  if (value === "callback_requested") return "callback_requested";
  if (value === "unresolved" || value === "unknown") return "unresolved";
  return null;
}

function transcriptFromOfficialShape(json: Json): CallePollResult["transcript"] {
  const recipients = Array.isArray(json.recipients) ? json.recipients : [];
  const turns: Array<{
    speaker: "bot" | "user";
    text: string;
    offset: number;
    ordinal: number;
  }> = [];
  let ordinal = 0;
  for (const recipientValue of recipients) {
    const recipient = asJson(recipientValue);
    const attempts = Array.isArray(recipient?.attempts) ? recipient.attempts : [];
    for (const attemptValue of attempts) {
      const attempt = asJson(attemptValue);
      const transcriptTurns = Array.isArray(attempt?.transcript_turns)
        ? attempt.transcript_turns
        : [];
      for (const turnValue of transcriptTurns) {
        const turn = asJson(turnValue);
        if (!turn || typeof turn.text !== "string") continue;
        turns.push({
          speaker:
            turn.speaker === "user" || turn.speaker === "recipient"
              ? "user"
              : "bot",
          text: turn.text,
          offset:
            typeof turn.offset_seconds === "number"
              ? turn.offset_seconds
              : Number.POSITIVE_INFINITY,
          ordinal: ordinal++,
        });
      }
    }
  }
  return turns
    .sort((a, b) => a.offset - b.offset || a.ordinal - b.ordinal)
    .map(({ speaker, text }) => ({ speaker, text }));
}

function transcriptFromLegacyShape(json: Json): CallePollResult["transcript"] {
  if (!Array.isArray(json.transcript)) return [];
  return json.transcript.flatMap((value) => {
    const row = asJson(value);
    if (!row || typeof (row.text ?? row.content) !== "string") return [];
    return [{
      speaker:
        row.speaker === "user" || row.role === "user"
          ? ("user" as const)
          : ("bot" as const),
      text: String(row.text ?? row.content),
    }];
  });
}

function confidenceScore(json: Json): number | null {
  if (typeof json.completion_confidence === "number") {
    return json.completion_confidence;
  }
  const confidence = asJson(json.completion_confidence);
  return typeof confidence?.score === "number" ? confidence.score : null;
}

/** Pure parser used by fixture tests; it performs no I/O. */
export function parseCallePollResponse(
  callId: string,
  json: Json,
): CallePollResult {
  const statusRaw = String(json.status || json.state || "unknown");
  const recipients = Array.isArray(json.recipients) ? json.recipients : [];
  const firstRecipient = asJson(recipients[0]);
  const structured =
    asJson(firstRecipient?.structured_result) ??
    asJson(json.structured_result) ??
    asJson(json.recipient_result) ??
    asJson(json.result) ??
    asJson(json.structured);
  const officialTranscript = transcriptFromOfficialShape(json);
  const transcript =
    officialTranscript.length > 0
      ? officialTranscript
      : transcriptFromLegacyShape(json);
  const business = deriveBusinessOutcome(structured);
  const score = confidenceScore(json);
  const confidence = asJson(json.completion_confidence);
  const highConfidence =
    (score !== null && score >= 0.8) || confidence?.label === "high";
  const reliableTranscript =
    json.reliable_transcript === true ||
    (json.task_completed === true && highConfidence && transcript.length > 0);
  const explicit = (name: string): unknown =>
    structured?.[name] ?? json[name];

  return {
    call_id: callId,
    status: mapPollStatus(statusRaw),
    provider_state: mapProviderState(statusRaw),
    business_outcome: business ?? "unresolved",
    transcript,
    structured,
    confirmation_question_asked:
      explicit("confirmation_question_asked") === true,
    answer_after_question: explicit("answer_after_question") === true,
    slot_matches_offered: explicit("slot_matches_offered") === true,
    schema_valid: structured !== null && business !== null,
    reliable_transcript: reliableTranscript,
    // Unknown conflict state cannot support an affirmative result.
    transcript_result_conflict:
      explicit("transcript_result_conflict") !== false,
  };
}

export class LiveCalleAdapter implements CalleAdapter {
  readonly mode = "live" as const;
  readonly idempotency_guarantee = "unverified" as const;
  private lastCreateByKey = new Map<string, string>();

  constructor(
    private readonly opts: {
      api_key?: string;
      base_url?: string;
      budget_remaining?: number;
      experiment_id?: string;
      request_timeout_ms?: number;
    } = {},
  ) {}

  private baseUrl(): string {
    return (this.opts.base_url || process.env.CALLE_BASE_URL || OFFICIAL_ORIGIN).replace(
      /\/$/,
      "",
    );
  }

  private apiKey(): string {
    return this.opts.api_key || process.env.CALLE_API_KEY || "";
  }

  private fail(code: string, message: string): never {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    throw error;
  }

  private experimentId(): string {
    return this.opts.experiment_id || process.env.CALLE_LIVE_EXPERIMENT || "";
  }

  private assertCredentialTargetAllowed(): void {
    let url: URL | null = null;
    try {
      url = new URL(this.baseUrl());
    } catch {
      this.fail("BAD_ORIGIN", "invalid CALL-E base URL");
    }
    if (
      !url ||
      url.protocol !== "https:" ||
      url.origin !== OFFICIAL_ORIGIN ||
      !["", "/"].includes(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      this.fail(
        "BAD_ORIGIN",
        "CALL-E key may only be sent to the exact official HTTPS origin",
      );
    }
    if (!this.apiKey()) this.fail("NO_API_KEY", "CALLE_API_KEY missing");
  }

  private assertCallingWindow(): void {
    const timeZone = process.env.CALLE_LIVE_TIMEZONE || "";
    const start = Number(process.env.CALLE_LIVE_WINDOW_START);
    const end = Number(process.env.CALLE_LIVE_WINDOW_END);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start > 23 ||
      end < 0 ||
      end > 23
    ) {
      this.fail("INVALID_CALLING_WINDOW", "valid live calling window is required");
    }
    let hour: number;
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
      }).formatToParts(new Date());
      hour = Number(parts.find((part) => part.type === "hour")?.value);
    } catch {
      this.fail("INVALID_IANA_TIMEZONE", "valid live IANA timezone is required");
    }
    const inWindow =
      start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    if (!inWindow) {
      this.fail("OUTSIDE_CALLING_WINDOW", "live create is outside the calling window");
    }
  }

  private assertLiveAllowed(): void {
    const fail = (code: string, message: string): never => {
      return this.fail(code, message);
    };
    this.assertCredentialTargetAllowed();
    if (isGlobalStopActive()) {
      fail("GLOBAL_STOP", "external or durable operator global stop is active");
    }
    if (process.env.SPIKE_STOP !== "0") {
      fail(
        process.env.SPIKE_STOP === "1" ? "GLOBAL_STOP" : "STOP_NOT_CONFIRMED",
        "SPIKE_STOP must be explicitly set to 0 for a named live experiment",
      );
    }
    if (process.env.SPIKE_LIVE !== "1") {
      fail("LIVE_REFUSED", "live adapter refused without SPIKE_LIVE=1");
    }

    const experimentId = this.experimentId();
    if (
      !/^[A-Z0-9_]+$/.test(experimentId) ||
      process.env.CALLE_LIVE_CONFIRMATION !==
        confirmationTokenFor(experimentId)
    ) {
      fail(
        "LIVE_EXPERIMENT_NOT_CONFIRMED",
        "named live experiment confirmation is missing or invalid",
      );
    }
    if (!Number.isInteger(this.budgetRemaining()) || this.budgetRemaining() < 1) {
      fail("LIVE_BUDGET_EXHAUSTED", "no explicit live-call budget remains");
    }
    if (process.env.CALLE_LIVE_CONSENT !== "1") {
      fail("NO_CONSENT", "explicit live-call consent is missing");
    }
    if (process.env.CALLE_LIVE_MAX_CALLS !== "1") {
      fail("BAD_LIVE_LIMIT", "CALLE_LIVE_MAX_CALLS must equal 1");
    }
    this.assertCallingWindow();
  }

  private assertPayloadAllowed(payload: CanonicalCallPayload): void {
    const phones = payload.recipients.flatMap((recipient) => recipient.phones);
    const allowlist = new Set(
      (process.env.CALLE_LIVE_ALLOWLIST || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (
      phones.length !== 1 ||
      !/^\+[1-9]\d{7,14}$/.test(phones[0] ?? "") ||
      !allowlist.has(phones[0]!)
    ) {
      const error = new Error(
        "live payload must contain exactly one explicitly allowlisted E.164 recipient",
      ) as Error & { code: string };
      error.code = "LIVE_RECIPIENT_NOT_ALLOWED";
      throw error;
    }
  }

  /** Read-only budget signal. It is never changed by mock/simulation paths. */
  budgetRemaining(): number {
    const value = Number(
      this.opts.budget_remaining ?? process.env.CALLE_LIVE_BUDGET_REMAINING,
    );
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl()}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(this.opts.request_timeout_ms ?? 15_000),
    });
  }

  private reserveLiveDispatch(args: {
    idempotency_key: string;
    payload: CanonicalCallPayload;
  }): void {
    const experimentId = this.experimentId();
    const configuredPath = process.env.CALLE_LIVE_RESERVATION_FILE;
    const path = configuredPath
      ? resolve(configuredPath)
      : join(
          process.cwd(),
          ".data",
          "live-reservations",
          `${experimentId.toLowerCase()}.one-shot.lock.json`,
        );
    mkdirSync(dirname(path), { recursive: true });
    let fd: number;
    try {
      fd = openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        this.fail(
          "LIVE_DISPATCH_ALREADY_RESERVED",
          "named live experiment already reserved its one allowed create",
        );
      }
      throw error;
    }
    try {
      const fingerprint = (value: string): string =>
        createHash("sha256").update(value).digest("hex");
      writeFileSync(
        fd,
        `${JSON.stringify(
          {
            schema_version: 1,
            experiment: experimentId,
            state: "dispatch_reserved",
            reserved_at: new Date().toISOString(),
            idempotency_key_sha256: fingerprint(args.idempotency_key),
            wire_payload_sha256: fingerprint(JSON.stringify(args.payload)),
            policy: "one_create_never_auto_remove",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    } finally {
      closeSync(fd);
    }
  }

  async createCall(args: {
    idempotency_key: string;
    payload: CanonicalCallPayload;
  }): Promise<CalleCreateResult> {
    this.assertLiveAllowed();
    this.assertPayloadAllowed(args.payload);
    this.reserveLiveDispatch(args);
    const prior = this.lastCreateByKey.get(args.idempotency_key);
    const response = await this.request("/v1/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": args.idempotency_key,
      },
      body: JSON.stringify(args.payload),
    });
    const text = await response.text();
    let json: Json = {};
    try {
      json = asJson(JSON.parse(text)) ?? {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      if (process.env.CALLE_LIVE_DIAGNOSE === "1") {
        const redactedBody = text.replace(/\+?\d{7,15}/g, "<redacted>").slice(0, 500);
        console.error(
          `DIAGNOSE createCall HTTP ${response.status} ${response.statusText} :: ${redactedBody}`,
        );
      }
      const error = new Error(
        `CALL-E createCall failed with HTTP ${response.status}`,
      ) as Error & { code: string; status: number };
      error.code = "CREATE_FAILED";
      error.status = response.status;
      throw error;
    }
    const callId = String(json.id || json.call_id || json.callId || "");
    if (!callId) {
      const error = new Error("CALL-E createCall response omitted call id") as Error & {
        code: string;
      };
      error.code = "CREATE_NO_ID";
      throw error;
    }
    const reused = Boolean(prior && prior === callId);
    this.lastCreateByKey.set(args.idempotency_key, callId);
    return {
      call_id: callId,
      status: String(json.status || "accepted"),
      reused,
    };
  }

  async getCall(callId: string): Promise<CallePollResult> {
    // Read-only incident/status checks remain available after a stop or after
    // the one-shot create reservation has closed.
    this.assertCredentialTargetAllowed();
    const response = await this.request(
      `/v1/calls/${encodeURIComponent(callId)}`,
      { headers: { Authorization: `Bearer ${this.apiKey()}` } },
    );
    const text = await response.text();
    let json: Json = {};
    try {
      json = asJson(JSON.parse(text)) ?? {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      const error = new Error(
        `CALL-E getCall failed with HTTP ${response.status}`,
      ) as Error & { code: string; status: number };
      error.code = "GET_FAILED";
      error.status = response.status;
      throw error;
    }
    return parseCallePollResponse(callId, json);
  }
}
