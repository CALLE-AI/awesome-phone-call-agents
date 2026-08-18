import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { CalleAPIError, CalleTimeoutError, type Call, type CreateCallInput } from "@call-e/calle";
import {
  MockCalleClient,
  RealCalleClient,
  agreeableLandlord,
  classifyCall,
  decliningPersona,
  extractRelayedDollars,
  mapOutcome,
  nextRetryAt,
  noAnswerPersona,
  stubbornTenant,
  toCallResult,
  withinCallWindow,
  type CallsApi,
} from "../src/calle.js";
import { consentSchema, offerRelaySchema, attestationSchema, parseConsent, parseOffer, parseAttestation } from "../src/schemas.js";
import { startWebhookServer, verifySignature, type WebhookCallEvent, type WebhookServer } from "../src/webhook.js";
import type { CasePolicy, RenderedCall } from "../src/types.js";

// All phone numbers in fixtures are masked/fictional (+1555xxxxxxx). Nothing is dialed.
const PHONE_A = "+15550000001";
const PHONE_B = "+15550000002";

function renderedCall(overrides: Partial<RenderedCall> = {}): RenderedCall {
  return {
    caseId: "case_test_001",
    round: 1,
    callee: "A",
    phone: PHONE_A,
    task: "Ask whether the callee consents to participate in mediated settlement calls about the security deposit dispute.",
    resultSchema: consentSchema(),
    idempotencyKey: "case_test_001:r1:A",
    metadata: { vertical: "security_deposit" },
    ...overrides,
  };
}

function offerCall(round: number, task: string, callee: "A" | "B" = "B"): RenderedCall {
  return renderedCall({
    round,
    callee,
    phone: callee === "A" ? PHONE_A : PHONE_B,
    task,
    resultSchema: offerRelaySchema(1200),
    idempotencyKey: `case_test_001:r${round}:${callee}`,
  });
}

function sdkCall(overrides: Partial<Call> = {}): Call {
  return {
    id: "call_abc123",
    object: "call_task",
    status: "completed",
    task: "fixture task",
    recipients: [],
    structuredResult: null,
    summary: null,
    taskCompleted: true,
    completionConfidence: null,
    evidence: [],
    metadata: {},
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-30T12:00:00Z",
    completedAt: "2026-07-30T12:03:00Z",
    ...overrides,
  };
}

function sdkRecipient(overrides: Partial<Call["recipients"][number]> = {}): Call["recipients"][number] {
  return {
    id: "rcpt_1",
    phones: [PHONE_A],
    locale: null,
    region: null,
    status: "completed",
    structuredResult: null,
    summary: null,
    attempts: [],
    ...overrides,
  };
}

function fakeCallsApi(outcome: Call | Error): {
  api: CallsApi;
  captured: Array<{ input: CreateCallInput; options?: { idempotencyKey?: string; timeoutMs?: number; intervalMs?: number } }>;
} {
  const captured: Array<{ input: CreateCallInput; options?: { idempotencyKey?: string; timeoutMs?: number; intervalMs?: number } }> = [];
  const api: CallsApi = {
    async createAndWait(input, options) {
      captured.push(options === undefined ? { input } : { input, options });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { api, captured };
}

// ---------------------------------------------------------------------------
// RealCalleClient
// ---------------------------------------------------------------------------

describe("RealCalleClient", () => {
  it("maps RenderedCall onto the SDK create input with correlation metadata", async () => {
    const { api, captured } = fakeCallsApi(sdkCall());
    const client = new RealCalleClient({ calls: api, waitTimeoutMs: 5000, pollIntervalMs: 50 });
    const req = renderedCall();
    await client.createAndWait(req);

    expect(captured).toHaveLength(1);
    const { input, options } = captured[0]!;
    expect(input.task).toBe(req.task);
    expect(input.recipient).toEqual({ phone: PHONE_A });
    expect(input.resultSchema).toBe(req.resultSchema);
    expect(input.metadata).toEqual({
      caseId: "case_test_001",
      round: "1",
      callee: "A",
      vertical: "security_deposit",
    });
    expect(options).toEqual({ idempotencyKey: req.idempotencyKey, timeoutMs: 5000, intervalMs: 50 });
  });

  it("maps a completed SDK call to a CallResult with flattened transcript", async () => {
    const call = sdkCall({
      structuredResult: { consent: "yes", concerns: "" },
      completionConfidence: { score: 0.91, label: "high" },
      evidence: ["Yes, I agree to take these calls."],
      recipients: [
        sdkRecipient({
          attempts: [
            {
              id: "att_1",
              phone: PHONE_A,
              status: "completed",
              startedAt: "2026-07-30T12:00:05Z",
              completedAt: "2026-07-30T12:02:40Z",
              summary: null,
              providerCallId: null,
              failureCode: null,
              failureMessage: null,
              transcriptTurns: [
                { offset_seconds: null, speaker: "bot", text: "Hello, this is the mediator." },
                { offset_seconds: 6.5, speaker: "user", text: "Yes, I agree to take these calls." },
              ],
            },
          ],
        }),
      ],
    });
    const { api } = fakeCallsApi(call);
    const client = new RealCalleClient({ calls: api });
    const result = await client.createAndWait(renderedCall());

    expect(result.callId).toBe("call_abc123");
    expect(result.outcome).toBe("completed");
    expect(result.structured).toEqual({ consent: "yes", concerns: "" });
    expect(parseConsent(result.structured)).toEqual({ consent: "yes", concerns: "" });
    expect(result.confidence).toEqual({ score: 0.91, label: "high" });
    expect(result.evidence).toEqual(["Yes, I agree to take these calls."]);
    expect(result.transcript).toEqual([
      { offsetSeconds: 0, speaker: "bot", text: "Hello, this is the mediator." },
      { offsetSeconds: 6.5, speaker: "user", text: "Yes, I agree to take these calls." },
    ]);
    expect(result.raw).toBe(call);
  });

  it("falls back to recipient-level structured result when call-level is null", () => {
    const call = sdkCall({
      structuredResult: null,
      recipients: [sdkRecipient({ structuredResult: { consent: "no", concerns: "stop calling" } })],
    });
    expect(toCallResult(call).structured).toEqual({ consent: "no", concerns: "stop calling" });
  });

  it("omits confidence when the SDK reports none", () => {
    const result = toCallResult(sdkCall({ completionConfidence: null }));
    expect("confidence" in result).toBe(false);
  });

  it("returns a timed_out result carrying the idempotency key when the wait times out", async () => {
    const { api } = fakeCallsApi(new CalleTimeoutError("gave up waiting"));
    const client = new RealCalleClient({ calls: api });
    const result = await client.createAndWait(renderedCall());
    expect(result.outcome).toBe("timed_out");
    expect(result.callId).toBe("unresolved:case_test_001:r1:A");
    expect(result.structured).toBeNull();
    expect(result.transcript).toEqual([]);
  });

  it("returns a failed result on API errors but rethrows programmer errors", async () => {
    const apiError = new CalleAPIError({ code: "invalid_request", message: "bad schema", status: 400 });
    const failing = new RealCalleClient({ calls: fakeCallsApi(apiError).api });
    const result = await failing.createAndWait(renderedCall());
    expect(result.outcome).toBe("failed");
    expect(result.raw).toEqual({ error: "CalleAPIError", message: "bad schema" });

    const buggy = new RealCalleClient({ calls: fakeCallsApi(new TypeError("undefined is not a function")).api });
    await expect(buggy.createAndWait(renderedCall())).rejects.toThrow(TypeError);
  });

  it("requires an apiKey when no calls facade is injected", () => {
    expect(() => new RealCalleClient({})).toThrow(TypeError);
  });
});

describe("mapOutcome", () => {
  it("classifies terminal statuses and failure codes", () => {
    expect(mapOutcome(sdkCall({ status: "completed" }))).toBe("completed");
    expect(mapOutcome(sdkCall({ status: "canceled" }))).toBe("failed");
    expect(mapOutcome(sdkCall({ status: "in_progress" }))).toBe("pending");
    expect(mapOutcome(sdkCall({ status: "failed", failureCode: "no_answer" }))).toBe("no_answer");
    expect(mapOutcome(sdkCall({ status: "failed", failureCode: "recipient_declined" }))).toBe("declined");
    expect(mapOutcome(sdkCall({ status: "failed", failureCode: "provider_timeout" }))).toBe("timed_out");
    expect(mapOutcome(sdkCall({ status: "failed", failureCode: "provider_unavailable" }))).toBe("failed");
    expect(mapOutcome(sdkCall({ status: "failed" }))).toBe("failed");
  });

  it("inspects attempt-level failure codes when call-level is null", () => {
    const call = sdkCall({
      status: "failed",
      recipients: [
        sdkRecipient({
          status: "failed",
          attempts: [
            {
              id: "att_1",
              phone: PHONE_B,
              status: "failed",
              startedAt: null,
              completedAt: null,
              summary: null,
              providerCallId: null,
              failureCode: "busy",
              failureMessage: "line busy after 4 rings",
              transcriptTurns: [],
            },
          ],
        }),
      ],
    });
    expect(mapOutcome(call)).toBe("no_answer");
  });
});

// ---------------------------------------------------------------------------
// MockCalleClient
// ---------------------------------------------------------------------------

describe("MockCalleClient", () => {
  it("records every request and returns a completed base result by default", async () => {
    const mock = new MockCalleClient();
    const req = renderedCall();
    const result = await mock.createAndWait(req);
    expect(mock.requests).toEqual([req]);
    expect(result.outcome).toBe("completed");
    expect(result.structured).toBeNull();
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.transcript.every((t) => ["bot", "user", "unknown"].includes(t.speaker))).toBe(true);
  });

  it("routes to the first matching matcher, then default", async () => {
    const mock = new MockCalleClient({
      matchers: [
        { when: (r) => r.round === 2, respond: () => ({ outcome: "no_answer" }) },
        { when: () => true, respond: () => ({ outcome: "declined" }) },
      ],
      default: () => ({ outcome: "failed" }),
    });
    expect((await mock.createAndWait(renderedCall({ round: 2 }))).outcome).toBe("no_answer");
    expect((await mock.createAndWait(renderedCall({ round: 3 }))).outcome).toBe("declined");
  });

  it("produces deterministic call ids for identical request sequences", async () => {
    const script = agreeableLandlord();
    const run = async () => {
      const mock = new MockCalleClient(script);
      const first = await mock.createAndWait(renderedCall());
      const second = await mock.createAndWait(offerCall(1, "Please share your opening position on the deposit."));
      return [first.callId, second.callId];
    };
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^mock_001_case_test_001_r1_A$/);
  });
});

describe("classifyCall / extractRelayedDollars", () => {
  it("classifies calls by result schema", () => {
    expect(classifyCall(renderedCall({ resultSchema: consentSchema() }))).toBe("consent");
    expect(classifyCall(renderedCall({ resultSchema: offerRelaySchema(100) }))).toBe("offer");
    expect(classifyCall(renderedCall({ resultSchema: attestationSchema() }))).toBe("attestation");
    expect(classifyCall(renderedCall({ resultSchema: { type: "object" } }))).toBe("unknown");
  });

  it("extracts only amounts framed as relayed proposals", () => {
    expect(extractRelayedDollars("The dispute concerns a $1,200 security deposit.")).toBeNull();
    expect(extractRelayedDollars("The other party has offered $650 to settle.")).toBe(650);
    expect(extractRelayedDollars("They previously proposed $500 but now offer $650.")).toBe(650);
    expect(extractRelayedDollars("Would you accept 725.50 dollars to close this out?")).toBe(725.5);
    expect(extractRelayedDollars("No numbers here.")).toBeNull();
  });
});

describe("personas", () => {
  it("agreeableLandlord consents, opens at 400, and accepts a relayed 650", async () => {
    const mock = new MockCalleClient(agreeableLandlord());

    const consent = await mock.createAndWait(renderedCall());
    expect(parseConsent(consent.structured)?.consent).toBe("yes");

    const opening = await mock.createAndWait(offerCall(1, "Please share your opening position on the deposit dispute."));
    const openOffer = parseOffer(opening.structured);
    expect(openOffer).toMatchObject({ offer_kind: "open", amount_dollars: 400 });
    expect(openOffer!.verbatim_quote).toContain("$400");
    expect(opening.evidence).toContain(openOffer!.verbatim_quote);

    const accepting = await mock.createAndWait(offerCall(3, "The tenant has offered $650 to settle. What would you like to do?"));
    expect(parseOffer(accepting.structured)).toMatchObject({ offer_kind: "accept", amount_dollars: 650 });
  });

  it("agreeableLandlord counters below its ceiling when the relayed ask is too high", async () => {
    const mock = new MockCalleClient(agreeableLandlord());
    const result = await mock.createAndWait(offerCall(3, "The tenant has countered, proposing $1,100."));
    const offer = parseOffer(result.structured);
    expect(offer!.offer_kind).toBe("counter");
    expect(offer!.amount_dollars).toBeLessThanOrEqual(700);
    expect(offer!.amount_dollars).toBeGreaterThanOrEqual(400);
  });

  it("stubbornTenant opens at the full amount and concedes ~20% per own round", async () => {
    const mock = new MockCalleClient(stubbornTenant(1200));

    const opening = await mock.createAndWait(offerCall(1, "Please share your opening position.", "A"));
    expect(parseOffer(opening.structured)).toMatchObject({ offer_kind: "open", amount_dollars: 1200 });

    const roundThree = await mock.createAndWait(offerCall(3, "The landlord has offered $500.", "A"));
    expect(parseOffer(roundThree.structured)).toMatchObject({ offer_kind: "counter", amount_dollars: 960 });

    // Next concession at round 3 would be 768, so a relayed 800 is acceptable.
    const accepting = await mock.createAndWait(offerCall(3, "The landlord has offered $800.", "A"));
    expect(parseOffer(accepting.structured)).toMatchObject({ offer_kind: "accept", amount_dollars: 800 });
  });

  it("personas answer attestation calls by repeating the quoted phrase verbatim", async () => {
    const mock = new MockCalleClient(stubbornTenant());
    const result = await mock.createAndWait(
      renderedCall({
        resultSchema: attestationSchema(),
        task:
          "Read the terms back, then ask the callee to repeat this confirmation phrase back " +
          'exactly, word for word: "amber falcon river stone".',
      }),
    );
    expect(parseAttestation(result.structured)).toEqual({
      phrase_spoken: "amber falcon river stone",
      agrees_to_terms: "yes",
    });
  });

  // Regression: settlement conditions are quoted verbatim in an attestation task
  // and appear BEFORE the confirmation phrase. A persona that echoed the first
  // quoted run in the task would attest to a condition instead of the phrase,
  // and the failure would look like a broken attestation rather than a bad mock.
  it("echoes the confirmation phrase, not settlement conditions quoted earlier", async () => {
    const mock = new MockCalleClient(stubbornTenant());
    const result = await mock.createAndWait(
      renderedCall({
        resultSchema: attestationSchema(),
        task:
          "Read the settlement terms exactly, with no additions: a settlement of $700, with " +
          'these conditions, stated verbatim: "tenant returns both mailbox keys". Then ask the ' +
          'callee to repeat this confirmation phrase back exactly, word for word: "topaz chowder cyclone".',
      }),
    );
    expect(parseAttestation(result.structured)).toEqual({
      phrase_spoken: "topaz chowder cyclone",
      agrees_to_terms: "yes",
    });
  });

  it("throws rather than echoing a wrong default when no phrase is present", async () => {
    const mock = new MockCalleClient(stubbornTenant());
    await expect(
      mock.createAndWait(
        renderedCall({
          resultSchema: attestationSchema(),
          task: "Confirm the settlement terms with the callee.",
        }),
      ),
    ).rejects.toThrow(/no quoted confirmation phrase/i);
  });

  it("noAnswerPersona never completes; decliningPersona says no to consent and declines the rest", async () => {
    const silent = new MockCalleClient(noAnswerPersona());
    const missed = await silent.createAndWait(renderedCall());
    expect(missed.outcome).toBe("no_answer");
    expect(missed.structured).toBeNull();
    expect(missed.transcript).toEqual([]);

    const decliner = new MockCalleClient(decliningPersona());
    const consent = await decliner.createAndWait(renderedCall());
    expect(consent.outcome).toBe("completed");
    expect(parseConsent(consent.structured)?.consent).toBe("no");

    const offer = await decliner.createAndWait(offerCall(1, "Please share your position."));
    expect(offer.outcome).toBe("declined");
    expect(offer.structured).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Policy helpers
// ---------------------------------------------------------------------------

const basePolicy: CasePolicy = {
  maxRounds: 6,
  coolingOffMinutes: 0,
  callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
  retryDelaysMinutes: [15, 60],
  ttlHours: 72,
};

describe("withinCallWindow", () => {
  it("evaluates the window in the callee-local timezone", () => {
    // 15:00Z on Jul 30 is 11:00 in America/New_York (EDT) — inside 9..20.
    expect(withinCallWindow(basePolicy, "2026-07-30T15:00:00Z")).toBe(true);
    // 02:00Z is 22:00 EDT the previous evening — outside.
    expect(withinCallWindow(basePolicy, "2026-07-30T02:00:00Z")).toBe(false);
  });

  it("treats start as inclusive and end as exclusive, with per-call timezone override", () => {
    expect(withinCallWindow(basePolicy, "2026-07-30T09:00:00Z", "UTC")).toBe(true);
    expect(withinCallWindow(basePolicy, "2026-07-30T20:00:00Z", "UTC")).toBe(false);
    expect(withinCallWindow(basePolicy, "2026-07-30T19:59:00Z", "UTC")).toBe(true);
  });

  it("supports windows crossing midnight and rejects degenerate windows", () => {
    const night: CasePolicy = { ...basePolicy, callWindow: { startHour: 22, endHour: 6, timezone: "UTC" } };
    expect(withinCallWindow(night, "2026-07-30T23:00:00Z")).toBe(true);
    expect(withinCallWindow(night, "2026-07-30T05:00:00Z")).toBe(true);
    expect(withinCallWindow(night, "2026-07-30T12:00:00Z")).toBe(false);

    const empty: CasePolicy = { ...basePolicy, callWindow: { startHour: 9, endHour: 9, timezone: "UTC" } };
    expect(withinCallWindow(empty, "2026-07-30T09:30:00Z")).toBe(false);
  });

  it("throws on unparseable timestamps", () => {
    expect(() => withinCallWindow(basePolicy, "not-a-date")).toThrow(RangeError);
  });
});

describe("nextRetryAt", () => {
  it("walks the retry ladder and returns null when exhausted", () => {
    expect(nextRetryAt(basePolicy, 0, "2026-07-30T12:00:00.000Z")).toBe("2026-07-30T12:15:00.000Z");
    expect(nextRetryAt(basePolicy, 1, "2026-07-30T12:00:00.000Z")).toBe("2026-07-30T13:00:00.000Z");
    expect(nextRetryAt(basePolicy, 2, "2026-07-30T12:00:00.000Z")).toBeNull();
  });

  it("empty ladder means single attempt; invalid indices throw", () => {
    const single: CasePolicy = { ...basePolicy, retryDelaysMinutes: [] };
    expect(nextRetryAt(single, 0, "2026-07-30T12:00:00.000Z")).toBeNull();
    expect(() => nextRetryAt(basePolicy, -1, "2026-07-30T12:00:00.000Z")).toThrow(RangeError);
    expect(() => nextRetryAt(basePolicy, 0.5, "2026-07-30T12:00:00.000Z")).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Webhook receiver
// ---------------------------------------------------------------------------

const SECRET = "whsec_test_only";

function sign(body: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifySignature", () => {
  const body = JSON.stringify({ callId: "call_1" });

  it("accepts a correct signature, in either hex case", () => {
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(verifySignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
  });

  it("rejects wrong secrets, tampered bodies, and malformed headers", () => {
    expect(verifySignature(body, sign(body, "other_secret"), SECRET)).toBe(false);
    expect(verifySignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, "", SECRET)).toBe(false);
    expect(verifySignature(body, "zz".repeat(32), SECRET)).toBe(false); // non-hex
    expect(verifySignature(body, sign(body).slice(0, 63), SECRET)).toBe(false); // odd length
    expect(verifySignature(body, sign(body).slice(0, 32), SECRET)).toBe(false); // wrong length
  });
});

describe("startWebhookServer", () => {
  let server: WebhookServer | undefined;
  const events: WebhookCallEvent[] = [];

  afterEach(async () => {
    await server?.close();
    server = undefined;
    events.length = 0;
  });

  async function start(options: { secret?: string; onEvent?: (e: WebhookCallEvent) => void | Promise<void> } = {}) {
    server = await startWebhookServer({
      port: 0,
      ...(options.secret === undefined ? {} : { secret: options.secret }),
      onEvent: options.onEvent ?? ((e) => void events.push(e)),
    });
    return `http://127.0.0.1:${server.port}`;
  }

  async function post(base: string, body: string, headers: Record<string, string> = {}) {
    return fetch(`${base}/calle/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  }

  it("accepts a signed event and hands {callId, ...raw} to onEvent", async () => {
    const base = await start({ secret: SECRET });
    const body = JSON.stringify({ type: "call.completed", data: { id: "call_777", status: "completed" } });
    const res = await post(base, body, { "x-calle-signature": sign(body) });
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      callId: "call_777",
      type: "call.completed",
      data: { id: "call_777", status: "completed" },
    });
  });

  it("prefers an explicit top-level callId over data.id", async () => {
    const base = await start({ secret: SECRET });
    const body = JSON.stringify({ callId: "call_explicit", data: { id: "call_other" } });
    await post(base, body, { "x-calle-signature": sign(body) });
    expect(events[0]?.callId).toBe("call_explicit");
  });

  it("rejects missing or invalid signatures without invoking onEvent", async () => {
    const base = await start({ secret: SECRET });
    const body = JSON.stringify({ callId: "call_1" });
    expect((await post(base, body)).status).toBe(401);
    expect((await post(base, body, { "x-calle-signature": sign(body, "wrong") })).status).toBe(401);
    expect(events).toHaveLength(0);
  });

  it("skips signature enforcement when no secret is configured", async () => {
    const base = await start();
    const res = await post(base, JSON.stringify({ callId: "call_unsigned" }));
    expect(res.status).toBe(200);
    expect(events[0]?.callId).toBe("call_unsigned");
  });

  it("404s other routes/methods and 400s bad payloads", async () => {
    const base = await start();
    expect((await fetch(`${base}/calle/webhook`, { method: "GET" })).status).toBe(404);
    expect((await fetch(`${base}/other`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await post(base, "not json")).status).toBe(400);
    expect((await post(base, JSON.stringify([1, 2]))).status).toBe(400);
    expect((await post(base, JSON.stringify({ noCallId: true }))).status).toBe(400);
    expect(events).toHaveLength(0);
  });

  it("returns 500 when the event handler throws", async () => {
    const base = await start({
      onEvent: () => {
        throw new Error("boom");
      },
    });
    const res = await post(base, JSON.stringify({ callId: "call_1" }));
    expect(res.status).toBe(500);
  });
});
