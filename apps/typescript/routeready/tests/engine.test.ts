import { describe, expect, it } from "vitest";
import { loadDay } from "../src/core/day.js";
import { ScriptedPort } from "../src/calle/ports.js";
import { RouteEngine, runDay, type EngineOptions } from "../src/engine/engine.js";

const { day, travel } = loadDay();

function calledDay(runId: string): EngineOptions {
  const port = new ScriptedPort(new Map(day.stops.map((stop) => [stop.id, stop])), day.truth, day.merchant);
  return { day, travel, runId, routeCall: (stop) => ({ port, target: { phone: stop.phone, region: "BD" } }) };
}

describe("RouteEngine on the demo day", () => {
  it("places no calls on the baseline day", async () => {
    const engine = await runDay({ day, travel, runId: "test-baseline" });
    expect(engine.done).toBe(true);
    expect(engine.metrics.calls).toBe(0);
    expect(engine.metrics.failedAttempts).toBeGreaterThan(0);
  });

  it("calls ahead, re-orders, and has fewer failed attempts than the baseline", async () => {
    const baseline = await runDay({ day, travel, runId: "test-baseline" });
    const engine = await runDay(calledDay("test-adaptive"));
    expect(engine.done).toBe(true);
    expect(engine.metrics.failedAttempts).toBeLessThan(baseline.metrics.failedAttempts);
    expect(engine.events.some((event) => event.type === "reordered")).toBe(true);
  });

  it("keeps one call in flight and calls each stop at most once", async () => {
    const engine = await runDay(calledDay("test-one-line"));
    let open = 0;
    let most = 0;
    const called: string[] = [];
    for (const event of engine.events) {
      if (event.type === "call_started") {
        open++;
        called.push(event.stopId);
      }
      if (event.type === "call_result" || (event.type === "call_error" && event.final)) open--;
      most = Math.max(most, open);
    }
    expect(most).toBe(1);
    expect(new Set(called).size).toBe(called.length);
  });

  it("starts no call while calls are held", async () => {
    const engine = new RouteEngine(calledDay("test-hold"));
    engine.holdCalls = true;
    for (let now = 0; now <= 20; now += 0.25) await engine.advance(now);
    expect(engine.metrics.calls).toBe(0);
  });

  it("changes nothing for a customer who did not answer", async () => {
    const engine = await runDay(calledDay("test-no-answer"));
    const result = engine.events.find((event) => event.type === "call_result" && event.stopId === "s4");
    if (result) expect(result).toMatchObject({ verified: false });
    expect(engine.states.get("s4")?.plan).toEqual({ kind: "no_change" });
  });
});
