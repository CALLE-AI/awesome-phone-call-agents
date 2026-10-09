import { describe, expect, it } from "vitest";
import { BLOOD_INQUIRY_RESULT_SCHEMA, BLOOD_RESERVE_RESULT_SCHEMA, HOLD_RESULT_SCHEMA, INQUIRY_RESULT_SCHEMA } from "@/lib/calltasks";
import { derivePhase } from "@/lib/mission";
import { createSimulatedCall, getSimulatedCall, getSimulatedEvents, type SimulatedCallInput } from "@/lib/simulator";

const base: SimulatedCallInput = {
  kind: "inquiry",
  seed: 1,
  controlled: false,
  name: "Test Pharmacy",
  medication: "Amoxicillin 400 mg/5 mL Oral Suspension",
  quantity: "one 100 mL bottle",
  alternative: "a different strength",
  holdName: "Maya R.",
  staffName: "Dana",
};

const at = (id: string, createdAt: string, ms: number) => {
  const call = getSimulatedCall(id, Date.parse(createdAt) + ms)!;
  const events = getSimulatedEvents(id, Date.parse(createdAt) + ms)!;
  return { call, events, phase: derivePhase(call, events) };
};

describe("simulated CALL-E calls", () => {
  it("issue ids that satisfy the CALL-E call id pattern", () => {
    const call = createSimulatedCall(base);
    expect(call.id).toMatch(/^call_[A-Za-z0-9_-]+$/);
    expect(call.status).toBe("queued");
    expect(call.simulated).toBe(true);
  });

  it("walk through IVR, conversation, extraction, and a schema-shaped result", () => {
    const { id, createdAt } = createSimulatedCall(base);
    expect(at(id, createdAt, 2000).phase).toBe("dialing");
    expect(at(id, createdAt, 5000).phase).toBe("ivr");
    const talking = at(id, createdAt, 9000);
    expect(talking.phase).toBe("talking");
    expect(talking.call.attempts[0].transcriptTurns.length).toBeGreaterThan(0);
    expect(at(id, createdAt, 29_500).phase).toBe("extracting");

    const done = at(id, createdAt, 120_000);
    expect(done.phase).toBe("done");
    expect(Object.keys(done.call.structuredResult!).sort()).toEqual([...INQUIRY_RESULT_SCHEMA.required].sort());
    expect(done.call.completionConfidence?.label).toBe("high");
  });

  it("report hold music as its own phase", () => {
    const { id, createdAt } = createSimulatedCall({ ...base, seed: 0 });
    expect(at(id, createdAt, 6000).phase).toBe("on_hold");
  });

  it("model a no-answer as a failed call with no structured result", () => {
    const { id, createdAt } = createSimulatedCall({ ...base, seed: 5 });
    const done = at(id, createdAt, 15_000);
    expect(done.call.status).toBe("failed");
    expect(done.call.structuredResult).toBeNull();
    expect(done.call.failureCode).toBe("no_answer");
  });

  it("open with a disclosure refusal for controlled substances", () => {
    const { id, createdAt } = createSimulatedCall({ ...base, seed: 0, controlled: true });
    expect(at(id, createdAt, 120_000).call.structuredResult?.stock_status).toBe("refused_to_disclose");
  });

  it("return hold results that match the hold schema", () => {
    const { id, createdAt } = createSimulatedCall({ ...base, kind: "hold" });
    const done = at(id, createdAt, 120_000);
    expect(Object.keys(done.call.structuredResult!).sort()).toEqual([...HOLD_RESULT_SCHEMA.required].sort());
    expect(done.call.structuredResult?.hold_name).toBe("Maya R.");
  });

  it("walk blood bank calls to a result that matches the blood schema", () => {
    const { id, createdAt } = createSimulatedCall({ ...base, kind: "blood_inquiry", seed: 1, medication: "2 units of O negative (O-) platelets", quantity: "2 units" });
    const done = at(id, createdAt, 120_000);
    expect(done.phase).toBe("done");
    expect(Object.keys(done.call.structuredResult!).sort()).toEqual([...BLOOD_INQUIRY_RESULT_SCHEMA.required].sort());
    expect(done.call.structuredResult?.stock_status).toBe("in_stock");
  });

  it("return blood reservations that match the reservation schema", () => {
    const { id, createdAt } = createSimulatedCall({ ...base, kind: "blood_reserve" });
    const done = at(id, createdAt, 120_000);
    expect(Object.keys(done.call.structuredResult!).sort()).toEqual([...BLOOD_RESERVE_RESULT_SCHEMA.required].sort());
    expect(done.call.structuredResult?.reserve_name).toBe("Maya R.");
  });

  it("reject tampered ids", () => {
    expect(getSimulatedCall("call_sim_bm90LWpzb24")).toBeNull();
    expect(getSimulatedCall("call_realcall123")).toBeNull();
  });
});
