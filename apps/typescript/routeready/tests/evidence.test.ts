import type { Call } from "@call-e/calle";
import { describe, expect, it } from "vitest";
import { gateCall } from "../src/core/evidence.js";

const PHONE = "+15555550102";
const GOOD = {
  reached_recipient: "yes",
  readiness: "within_15_min",
  ready_clock_time: "",
  handoff: "in_person",
  cod_cash_ready: "yes",
  landmark: "Opposite the pharmacy",
  customer_quote: "I'm at the market, I need about fifteen more minutes.",
  quote_in_english: "I'm at the market, I need about fifteen more minutes.",
};

function call(overrides: Partial<Call> = {}, result: Record<string, unknown> | null = GOOD, phone = PHONE): Call {
  return {
    id: "call_test",
    object: "call_task",
    status: "completed",
    task: "test",
    recipients: [
      {
        id: "rcp_1",
        phones: [phone],
        locale: "en-US",
        region: "US",
        status: "completed",
        structuredResult: result,
        summary: null,
        attempts: [],
      },
    ],
    structuredResult: null,
    summary: null,
    taskCompleted: true,
    completionConfidence: { score: 0.9, label: "high" },
    evidence: [],
    metadata: {},
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-09-12T04:00:00Z",
    completedAt: "2026-09-12T04:01:00Z",
    ...overrides,
  };
}

describe("gateCall", () => {
  it("accepts a completed call backed by the customer's own words", () => {
    const gate = gateCall(call(), PHONE);
    expect(gate.verified).toBe(true);
  });

  it.each([
    ["a failed call", call({ status: "failed" })],
    ["a result for another number", call({}, GOOD, "+15555550199")],
    ["a missing result", call({}, null)],
    ["an answer outside the schema", call({}, { ...GOOD, readiness: "soon" })],
    ["an unreached customer", call({}, { ...GOOD, reached_recipient: "no" })],
    ["an answer without a quote", call({}, { ...GOOD, customer_quote: "  " })],
    ["an unstated time", call({}, { ...GOOD, readiness: "unknown" })],
    ["a low-confidence judgment", call({ completionConfidence: { score: 0.3, label: "low" } })],
  ])("rejects %s", (_name, input) => {
    expect(gateCall(input, PHONE).verified).toBe(false);
  });
});
