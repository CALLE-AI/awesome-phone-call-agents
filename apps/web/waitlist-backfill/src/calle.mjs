/**
 * CALL-E transport. Two implementations, one interface:
 *
 *   FakeCalleClient  - the default. Places no calls, needs no credentials, deterministic.
 *   LiveCalleClient  - the real thing, via the official @call-e/calle SDK.
 *
 * The fake is not a testing afterthought; it is the default execution path for the whole app, so
 * that running this repo's app can never surprise someone with a real phone call.
 */

/**
 * What we ask CALL-E to return for each person we ring. The whole run loop is driven by
 * `can_take_slot`, so it is a closed enum rather than free text.
 */
export const SLOT_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["can_take_slot"],
  properties: {
    can_take_slot: {
      type: "string",
      enum: ["yes", "no", "callback_requested"],
      description: "Whether this person accepted the offered appointment slot.",
    },
    callback_note: {
      type: "string",
      description: "Free text only when the person asked to be called back later.",
    },
  },
};

/**
 * Did this failure definitely leave no call behind, or might one still be running?
 *
 * THE SAFETY QUESTION THIS APP TURNS ON. There is one slot. If a request times out or the
 * connection drops after the provider has already accepted the call, the call is placed and we
 * never saw the response. Moving to the next person then puts two calls in flight for one
 * appointment and can promise it to two people, which is the exact failure the sequential design
 * exists to prevent.
 *
 * So the classification is fail-closed: only an outright rejection by the API - a 4xx that means
 * the request was never actioned - counts as definitively "no call exists". Timeouts, dropped
 * connections, 5xx, 408, 429 and anything unrecognised are all treated as ambiguous, because for
 * every one of them the provider may hold a call we cannot see.
 *
 * 401/403 are definitive (nothing was placed) but still halt the run, because every subsequent
 * call would fail the same way and the operator needs to fix credentials, not watch a loop retry.
 */
export function classifyTransportError(err) {
  const name = err?.name ?? err?.constructor?.name ?? "";
  const status = Number.isInteger(err?.status) ? err.status : null;

  // The ONLY failure this app can prove happened before a call could exist. The SDK raises
  // CalleAuthenticationError for 401/403, which means the request was rejected at authentication,
  // so nothing was created. It still halts, because every later call fails identically and the
  // operator needs to fix credentials rather than watch a loop retry - but there is nothing to
  // reconcile afterwards.
  if (name === "CalleAuthenticationError" || status === 401 || status === 403) {
    return {
      ambiguous: false,
      halt: true,
      code: "transport_not_authorised",
      detail: "The API rejected our credentials. No call was placed, and none can be until this is fixed.",
    };
  }

  // EVERYTHING ELSE HALTS AND MUST BE RECONCILED, INCLUDING THE REST OF 4xx.
  //
  // A previous version advanced on any 4xx except 408/429, on the assumption that a 4xx proves the
  // request never became a call. That assumption is not supported by anything: the SDK derives
  // `code` from whatever the response envelope contained and falls back to "internal_error", and
  // it documents no mapping from status to whether a call was created. A 409 in particular is a
  // natural way for a provider to report an existing idempotent or in-progress call, which is the
  // precise case where advancing would put two calls on one slot.
  //
  // So the rule is: fail closed unless the SDK proves otherwise, and it only proves it for auth.
  // If CALL-E later documents statuses or codes that guarantee pre-creation rejection, they can be
  // added here as an explicit allowlist, with the documentation cited.
  return {
    ambiguous: true,
    halt: true,
    code: "call_outcome_unknown",
    detail: "The request failed without a definite answer, so a call may already be in progress.",
  };
}

/** Build the call instruction. Boundaries are restated to the agent, not just checked by us. */
export function buildTask({ slot, contact, message }) {
  return [
    `You are calling ${contact.name} on behalf of ${slot.businessName}.`,
    `An appointment slot has become available: ${slot.service} at ${slot.startsAtLocal} (${slot.timeZone}).`,
    `Say this, in your own words but without changing the facts: "${message}"`,
    `Ask whether they can take this slot. Accept a yes, a no, or a request to be called back later.`,
    `Do not negotiate a different time. Do not give medical, legal or financial advice.`,
    `If the person says this is an emergency, tell them to contact their provider or emergency`,
    `services directly, and end the call.`,
    `Keep the call under two minutes. Thank them and end the call once you have an answer.`,
  ].join(" ");
}

export class FakeCalleClient {
  /**
   * @param {object} scripted  contactId -> "yes" | "no" | "callback_requested" | "no_answer"
   */
  constructor(scripted = {}) {
    this.scripted = scripted;
    this.placed = [];
  }

  get mode() {
    return "fake";
  }

  async placeCall({ task, contact, metadata, idempotencyKey }) {
    const outcome = this.scripted[contact.id] ?? "no";
    this.placed.push({ contactId: contact.id, idempotencyKey });
    const n = this.placed.length;
    if (outcome === "no_answer") {
      return {
        id: `fake_call_${n}`,
        status: "failed",
        taskCompleted: false,
        structuredResult: null,
        summary: "No answer.",
        failureCode: "no_answer",
        fake: true,
      };
    }
    return {
      id: `fake_call_${n}`,
      status: "completed",
      taskCompleted: true,
      structuredResult: { can_take_slot: outcome },
      summary: `Simulated: contact answered "${outcome}".`,
      failureCode: null,
      fake: true,
      _task: task,
      _metadata: metadata,
    };
  }
}

export class LiveCalleClient {
  constructor({ apiKey, baseUrl, timeoutMs = 300_000 }) {
    if (!apiKey) throw new Error("CALLE_API_KEY is required for live mode.");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this._client = null;
  }

  get mode() {
    return "live";
  }

  async _sdk() {
    if (this._client) return this._client;
    let mod;
    try {
      mod = await import("@call-e/calle");
    } catch {
      throw new Error(
        "Live mode needs the CALL-E SDK. Run `npm install` in this app directory first.",
      );
    }
    const options = { apiKey: this.apiKey };
    if (this.baseUrl) options.baseUrl = this.baseUrl;
    this._client = new mod.CalleClient(options);
    return this._client;
  }

  async placeCall({ task, contact, metadata, idempotencyKey }) {
    const sdk = await this._sdk();
    const input = {
      task,
      recipient: {
        phones: [contact.phone],
        // Region and locale are passed only when the waitlist record states them. They are not
        // derived from the phone number: see P4 and resolveTimeZone() in guardrails.mjs.
        ...(contact.region ? { region: contact.region } : {}),
        ...(contact.locale ? { locale: contact.locale } : {}),
      },
      recipientResultSchema: SLOT_RESULT_SCHEMA,
      metadata,
    };
    const done = await sdk.calls.createAndWait(input, {
      idempotencyKey,
      timeoutMs: this.timeoutMs,
    });
    return {
      id: done.id,
      status: done.status,
      taskCompleted: done.taskCompleted,
      structuredResult: done.recipients?.[0]?.structuredResult ?? done.structuredResult,
      summary: done.recipients?.[0]?.summary ?? done.summary,
      failureCode: done.failureCode,
      fake: false,
    };
  }
}

export function makeClient(env, scripted) {
  if (env.CALLE_MODE === "live") {
    return new LiveCalleClient({ apiKey: env.CALLE_API_KEY, baseUrl: env.CALLE_BASE_URL });
  }
  return new FakeCalleClient(scripted);
}
