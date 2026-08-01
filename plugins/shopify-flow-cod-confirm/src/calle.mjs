/**
 * CALL-E client for the COD gate.
 *
 * Two things matter here and they are both consequences of how CALL-E actually
 * behaves rather than how it is documented:
 *
 *  1. `webhook_url` is accepted on call creation but no webhook is delivered for
 *     a completed call (field-verified, late July 2026). So this client POLLS
 *     `GET /v1/calls/{id}` and never waits on a callback.
 *  2. A 2xx create response without a recognisable call id, or a network error
 *     mid-create, means the call may or may not exist. Those are reported as
 *     `ambiguous` and reconciled by replaying the SAME idempotency key, never by
 *     creating a second call.
 */

import { SAFETY_INSTRUCTION, RESULT_SCHEMA, TERMINAL_STATUSES, isE164 } from "./decision.mjs";

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

export class AmbiguousCallError extends Error {
  constructor(message, { idempotencyKey }) {
    super(message);
    this.name = "AmbiguousCallError";
    this.ambiguous = true;
    this.idempotencyKey = idempotencyKey;
  }
}

export class CalleClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.baseUrl]
   * @param {Function} [options.fetchImpl]  injected for tests / fake server
   * @param {Function} [options.sleep]      injected so tests do not wait
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch, sleep } = {}) {
    if (!apiKey) throw new Error("CalleClient requires an API key.");
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get #headers() {
    return {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  /**
   * Create one confirmation call. Returns { callId, raw }.
   * Throws AmbiguousCallError when creation may have partially succeeded.
   */
  async createCall({ phone, task, metadata, idempotencyKey }) {
    if (!isE164(phone)) throw new Error("Phone number must be E.164, for example +15005550100.");
    if (!idempotencyKey) throw new Error("createCall requires an idempotency key.");

    const body = {
      task: `${SAFETY_INSTRUCTION}\n\n${String(task || "").trim()}`,
      recipients: [{ phones: [phone.trim()] }],
      metadata,
      result_schema: RESULT_SCHEMA,
    };

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/calls`, {
        method: "POST",
        headers: { ...this.#headers, "idempotency-key": idempotencyKey },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new AmbiguousCallError(
        `Network error creating the call. The call may or may not have been placed. Replay with idempotency key ${idempotencyKey} before creating another.`,
        { idempotencyKey },
      );
    }

    const text = await response.text().catch(() => "");
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new AmbiguousCallError(
        `Unparseable response creating the call. Replay with idempotency key ${idempotencyKey}.`,
        { idempotencyKey },
      );
    }

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      const error = new Error(`CALL-E rejected the call: ${message}`);
      error.status = response.status;
      error.body = payload;
      // 5xx and 429 may have created the call server-side before failing.
      if (response.status >= 500 || response.status === 429) {
        throw new AmbiguousCallError(
          `CALL-E returned ${response.status}. The call may exist. Replay with idempotency key ${idempotencyKey}.`,
          { idempotencyKey },
        );
      }
      throw error;
    }

    const callId = extractCallId(payload);
    if (!callId) {
      throw new AmbiguousCallError(
        `CALL-E accepted the request but returned no call id. Replay with idempotency key ${idempotencyKey} to reconcile.`,
        { idempotencyKey },
      );
    }
    return { callId, raw: payload };
  }

  /** Fetch one call. Returns the raw call object. */
  async getCall(callId) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/calls/${encodeURIComponent(callId)}`, {
      method: "GET",
      headers: this.#headers,
    });
    const text = await response.text().catch(() => "");
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(`Failed to read call ${callId}: HTTP ${response.status}`);
      error.status = response.status;
      error.body = payload;
      throw error;
    }
    return payload?.call ?? payload?.data ?? payload;
  }

  /**
   * Poll until the call reaches a terminal state.
   *
   * There is no result webhook, so this is the only reliable completion signal.
   * Returns { call, timedOut }.
   */
  async waitForTerminal(callId, { intervalMs = 5000, timeoutMs = 240000, now = () => Date.now() } = {}) {
    const deadline = now() + timeoutMs;
    let last = null;
    for (;;) {
      last = await this.getCall(callId);
      const status = String(last?.status || "").toLowerCase();
      if (TERMINAL_STATUSES.has(status)) return { call: last, timedOut: false };
      if (now() >= deadline) return { call: last, timedOut: true };
      await this.sleep(intervalMs);
    }
  }
}

export function extractCallId(payload) {
  return (
    payload?.call_id ??
    payload?.id ??
    payload?.call?.id ??
    payload?.data?.id ??
    payload?.data?.call_id ??
    null
  );
}
