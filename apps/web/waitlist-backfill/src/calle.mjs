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
