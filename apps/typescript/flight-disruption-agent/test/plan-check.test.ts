import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlanCheck, Planner } from "../src/calle.ts";
import { DryRunGateway } from "../src/calle.ts";
import { loadCatalog } from "../src/data.ts";
import { Desk } from "../src/desk.ts";

const DAY_BEFORE = Date.parse("2026-09-19T08:00:00+07:00");

class FakePlanner implements Planner {
  seen: { phone: string; region: string; task: string }[] = [];
  constructor(private readonly answer: PlanCheck) {}
  async plan(input: { phone: string; region: string; task: string }): Promise<PlanCheck> {
    this.seen.push(input);
    return this.answer;
  }
}

function desk(planner?: Planner, planPhone?: string) {
  return new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now: () => DAY_BEFORE, planner, planPhone });
}

test("Check with CALL-E sends the exact call task to the planner and never dials", async () => {
  const planner = new FakePlanner({ ready: true, questions: [], goal: "Call Daniel. Callback number +6591234567." });
  const d0 = desk(planner, "+6591234567");
  const d = d0.reportDelay("NA721-2026-09-20", 240, "weather");
  const plan = await d0.checkWithCalle({ kind: "passenger", disruptionId: d.id, pnr: "M3P8RD" });
  assert.equal(plan.ready, true);
  assert.equal(plan.region, "SG");
  assert.equal(plan.destinationMasked, "+65 ••• 4567");
  assert.equal(plan.goal, "Call Daniel. Callback number ••• 4567.", "CALL-E's text is masked like any provider text");
  assert.equal(planner.seen[0]?.task, d0.preview(d.id, "M3P8RD").task);
  assert.equal(d0.snapshot().disruptions[0]?.bookings.find((b) => b.pnr === "M3P8RD")?.entry, null, "no call was recorded");
});

test("request calls can be checked too, and CALL-E's questions come back", async () => {
  const planner = new FakePlanner({ ready: false, questions: ["Calls to this region are not supported right now."], goal: null });
  const d0 = desk(planner, "+6591234567");
  const r = d0.submitRequest("L6F2KM", "change", null, "chat");
  const plan = await d0.checkWithCalle({ kind: "intake", id: r.request.id });
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.questions, ["Calls to this region are not supported right now."]);
  assert.match(planner.seen[0]?.task ?? "", /contacted TripKita through our chat/);
});

test("the check explains what is missing instead of failing silently", async () => {
  const d1 = desk(undefined, "+6591234567");
  const e1 = d1.reportDelay("NA721-2026-09-20", 240, "weather");
  await assert.rejects(d1.checkWithCalle({ kind: "passenger", disruptionId: e1.id, pnr: "M3P8RD" }), /turned off/);
  const d2 = desk(new FakePlanner({ ready: true, questions: [], goal: null }));
  const e2 = d2.reportDelay("NA721-2026-09-20", 240, "weather");
  await assert.rejects(d2.checkWithCalle({ kind: "passenger", disruptionId: e2.id, pnr: "M3P8RD" }), /CALLE_PLAN_PHONE/);
  const d3 = desk(new FakePlanner({ ready: true, questions: [], goal: null }), "+628123456789");
  const e3 = d3.reportDelay("NA721-2026-09-20", 240, "weather");
  await assert.rejects(d3.checkWithCalle({ kind: "passenger", disruptionId: e3.id, pnr: "M3P8RD" }), /Indonesia/);
});
