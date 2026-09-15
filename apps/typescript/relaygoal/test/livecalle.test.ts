import { describe, it, expect } from "vitest";
import {
  toCreateInput,
  toRequestOptions,
  pickTranscript,
  mapCallToResult,
  createLiveCalle,
} from "../src/core/livecalle";
import { runVerifiedGoal } from "../src/core/runGoal";
import type { CreateCallInput } from "../src/core/types";

// A structural stand-in for the @call-e/calle Call shape (real field names/nesting), so the
// adapter's mapping is exercised with NO package installed and NO API key.
function sdkCall(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    taskCompleted: true,
    completionConfidence: { score: 0.91, label: "high" },
    evidence: ["said the pickup is ready"],
    summary: "Order is ready for pickup.",
    structuredResult: { ready: "yes" },
    recipients: [
      {
        summary: "recipient-level summary",
        structuredResult: null,
        attempts: [
          { status: "failed", transcriptTurns: [] },
          {
            status: "completed",
            transcriptTurns: [
              { offset_seconds: 2, speaker: "bot", text: "Is order 123 ready?" },
              { offset_seconds: 5, speaker: "user", text: "Yes, it is ready." },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("toCreateInput — flat core request → nested SDK input", () => {
  it("nests the phone under recipient and passes resultSchema through", () => {
    const input: CreateCallInput = {
      task: "Ask if order 123 is ready",
      phone: "+12025550142",
      resultSchema: { type: "object" },
    };
    expect(toCreateInput(input)).toEqual({
      task: "Ask if order 123 is ready",
      recipient: { phone: "+12025550142" },
      resultSchema: { type: "object" },
    });
  });

  it("omits resultSchema when absent", () => {
    const input: CreateCallInput = { task: "t", phone: "+12025550142" };
    expect(toCreateInput(input)).toEqual({ task: "t", recipient: { phone: "+12025550142" } });
  });
});

describe("toRequestOptions — idempotency key rides in options, not the body", () => {
  it("carries the idempotency key and wait tuning into options", () => {
    const input: CreateCallInput = { task: "t", phone: "+12025550142", idempotencyKey: "k-1" };
    expect(toRequestOptions(input, { timeoutMs: 1000, intervalMs: 100 })).toEqual({
      idempotencyKey: "k-1",
      timeoutMs: 1000,
      intervalMs: 100,
    });
  });

  it("is empty when nothing is supplied", () => {
    expect(toRequestOptions({ task: "t", phone: "+12025550142" })).toEqual({});
  });
});

describe("pickTranscript — fail-closed transcript selection", () => {
  it("prefers the most recent completed attempt with turns", () => {
    const turns = pickTranscript(sdkCall().recipients[0] as never);
    expect(turns).toEqual([
      { offsetSeconds: 2, speaker: "bot", text: "Is order 123 ready?" },
      { offsetSeconds: 5, speaker: "user", text: "Yes, it is ready." },
    ]);
  });

  it("returns [] when no attempt produced turns (→ verifyOutcome fails closed)", () => {
    const recipient = { summary: null, structuredResult: null, attempts: [{ status: "failed", transcriptTurns: [] }] };
    expect(pickTranscript(recipient as never)).toEqual([]);
  });

  it("returns [] for an undefined recipient", () => {
    expect(pickTranscript(undefined)).toEqual([]);
  });

  it("maps a null offset_seconds to 0", () => {
    const recipient = {
      summary: null,
      structuredResult: null,
      attempts: [{ status: "completed", transcriptTurns: [{ offset_seconds: null, speaker: "user", text: "hi" }] }],
    };
    expect(pickTranscript(recipient as never)).toEqual([{ offsetSeconds: 0, speaker: "user", text: "hi" }]);
  });
});

describe("mapCallToResult — SDK Call → core CalleCallResult", () => {
  it("flattens a normal completed call, preferring the top-level structuredResult", () => {
    const r = mapCallToResult(sdkCall() as never);
    expect(r.status).toBe("completed");
    expect(r.taskCompleted).toBe(true);
    expect(r.completionConfidence).toEqual({ score: 0.91, label: "high" });
    expect(r.structuredResult).toEqual({ ready: "yes" });
    expect(r.summary).toBe("Order is ready for pickup.");
    expect(r.transcriptTurns).toHaveLength(2);
  });

  it("fills nullable taskCompleted/completionConfidence conservatively", () => {
    const r = mapCallToResult(sdkCall({ taskCompleted: null, completionConfidence: null }) as never);
    expect(r.taskCompleted).toBe(false);
    expect(r.completionConfidence).toEqual({ score: 0, label: "unknown" });
  });

  it("falls back to the recipient's structuredResult/summary when the top-level is null", () => {
    const r = mapCallToResult(
      sdkCall({
        structuredResult: null,
        summary: null,
        recipients: [
          {
            summary: "recipient-level summary",
            structuredResult: { ready: "recipient" },
            attempts: [{ status: "completed", transcriptTurns: [{ offset_seconds: 1, speaker: "bot", text: "hi" }] }],
          },
        ],
      }) as never,
    );
    expect(r.structuredResult).toEqual({ ready: "recipient" });
    expect(r.summary).toBe("recipient-level summary");
  });

  it("yields an empty transcript with no recipients (→ unreachable/unverified downstream)", () => {
    const r = mapCallToResult(sdkCall({ recipients: [] }) as never);
    expect(r.transcriptTurns).toEqual([]);
  });
});

describe("createLiveCalle — end to end through the real core", () => {
  it("drives runVerifiedGoal off a stubbed SDK client (no key, no network) and verifies a grounded field", async () => {
    const calls: Array<{ input: unknown; options: unknown }> = [];
    const stubSdk = {
      calls: {
        createAndWait: async (input: unknown, options: unknown) => {
          calls.push({ input, options });
          return sdkCall({
            structuredResult: { ready: "yes" },
            recipients: [
              {
                summary: null,
                structuredResult: null,
                attempts: [
                  {
                    status: "completed",
                    transcriptTurns: [
                      { offset_seconds: 3, speaker: "user", text: "Yes, order 123 is ready for pickup." },
                    ],
                  },
                ],
              },
            ],
          });
        },
      },
    };

    const client = createLiveCalle(stubSdk as never, { timeoutMs: 5000 });
    const outcome = await runVerifiedGoal(client, {
      task: "Ask if order 123 is ready",
      phone: "+12025550142",
      resultSchema: { type: "object", properties: { ready: { type: "string" } } },
      requestedKeys: ["ready"],
      idempotencyKey: "k-42",
    });

    // The adapter nested the phone and moved the idempotency key into options.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toMatchObject({ recipient: { phone: "+12025550142" } });
    expect(calls[0]!.options).toMatchObject({ idempotencyKey: "k-42" });

    // The core produced a real verdict from the mapped result.
    const ready = outcome.fields.find((f) => f.key === "ready");
    expect(ready?.status).toBe("verified");
    expect(ready?.quotes.length).toBeGreaterThan(0);
  });
});
