import type { CreateCallBody } from "./task.ts";

/**
 * Minimal CALL-E Developer API client (OpenAPI 0.7.0), built on fetch:
 *   POST /v1/calls        create one call task (Idempotency-Key makes retries safe)
 *   GET  /v1/calls/{id}   the authoritative snapshot, the only source of results
 *   GET  /v1/goals        authenticated and side-effect free: used as the key check
 */
export const CALLE_ORIGIN = "https://api.heycall-e.com";
export const TERMINAL = ["completed", "failed", "canceled"];

export type CallSnapshot = Record<string, unknown>;

export class CalleApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(`${status} ${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

/** The bearer token goes only to the official HTTPS origin, or to a loopback fake server. */
export function assertSafeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.origin !== CALLE_ORIGIN && !loopback)
    throw new Error(`Refusing to send the CALL-E key to ${url.origin}; use ${CALLE_ORIGIN} or a loopback fake server`);
  return url.origin;
}

export class CalleClient {
  readonly baseUrl: string;
  readonly #apiKey: string;

  constructor(apiKey: string, baseUrl: string = CALLE_ORIGIN) {
    if (!apiKey.trim()) throw new Error("CALLE_API_KEY is not set");
    this.#apiKey = apiKey.trim();
    this.baseUrl = assertSafeBaseUrl(baseUrl);
  }

  async #request(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<CallSnapshot> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await fetch(`${this.baseUrl}/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-JSON error bodies are reported by status */
    }
    if (!res.ok) {
      const err = (json.error ?? {}) as { code?: string; message?: string };
      throw new CalleApiError(res.status, err.code ?? `http_${res.status}`, err.message ?? text.slice(0, 200));
    }
    return json;
  }

  createCall(body: CreateCallBody, idempotencyKey: string) {
    return this.#request("POST", "/calls", body, idempotencyKey);
  }

  getCall(callId: string) {
    if (!/^call_[A-Za-z0-9_-]+$/.test(callId)) throw new Error(`Not a CALL-E call id: ${callId}`);
    return this.#request("GET", `/calls/${callId}`);
  }

  checkKey() {
    return this.#request("GET", "/goals?limit=1");
  }
}

// ---------------------------------------------------------------- snapshot readers

type Turn = { speaker?: string; text?: string; offset_seconds?: number | null };
type Attempt = { status?: string; summary?: string | null; failure_code?: string | null; failure_message?: string | null; transcript_turns?: Turn[] };
type Recipient = { structured_result?: unknown; summary?: string | null; attempts?: Attempt[] };

const text = (v: unknown) => (typeof v === "string" ? v : "");
const recipient = (call: CallSnapshot): Recipient => (call.recipients as Recipient[] | undefined)?.[0] ?? {};
const lastAttempt = (call: CallSnapshot): Attempt | undefined => recipient(call).attempts?.at(-1);

export function callId(call: CallSnapshot): string {
  const id = text(call.id);
  if (!id.startsWith("call_")) throw new Error("CALL-E did not return a call id");
  return id;
}

/** `recipient_result_schema` results live on the recipient; the task-level field is for `result_schema`. */
export const providerResult = (call: CallSnapshot): unknown => recipient(call).structured_result ?? null;

export const callSummary = (call: CallSnapshot): string =>
  text(call.summary) || text(recipient(call).summary) || text(lastAttempt(call)?.summary);

export function transcript(call: CallSnapshot): Array<{ speaker: "agent" | "supplier" | "unknown"; text: string }> {
  return (recipient(call).attempts ?? []).flatMap((attempt) =>
    (attempt.transcript_turns ?? [])
      .filter((turn) => text(turn.text).trim())
      .map((turn) => ({
        speaker: turn.speaker === "bot" ? "agent" as const : turn.speaker === "user" ? "supplier" as const : "unknown" as const,
        text: text(turn.text).trim(),
      })),
  );
}

/** Raw failure code and message, kept for support. Never branched on: there is no published enum. */
export function failureReason(call: CallSnapshot): string {
  const code = text(lastAttempt(call)?.failure_code) || text(call.failure_code);
  const message = text(lastAttempt(call)?.failure_message) || text(call.failure_message);
  if (!code && !message) return `CALL-E reported the call as ${text(call.status)}`;
  return message ? `${code || "failed"}: ${message}` : code;
}

/**
 * The state shown to the buyer. The task status is authoritative; the latest attempt refines
 * `in_progress` into ringing, on the call, and finalizing the result.
 */
export function lifecycleStatus(call: CallSnapshot): string {
  const status = text(call.status);
  if (status !== "in_progress") return status;
  const attempt = lastAttempt(call)?.status;
  if (attempt === "queued" || attempt === "dialing") return "ringing";
  if (attempt === "completed") return "finalizing";
  return "in_progress";
}
