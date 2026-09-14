import assert from "node:assert/strict";
import test from "node:test";
import {
  conflictedVendorIds,
  detectConflicts,
  intervalsOverlap,
  parseTime,
  readinessSummary,
  type VendorPlan,
} from "../lib/constraint-engine.ts";
import {
  fixtureVenue,
  initialVendorPlans,
  resolvedVendorPlans,
} from "../lib/fixture.ts";

test("strictly parses local HH:mm times", () => {
  assert.equal(parseTime("09:30"), 570);
  assert.equal(parseTime("23:59"), 1439);
  assert.equal(parseTime("9:30"), null);
  assert.equal(parseTime("24:00"), null);
  assert.equal(parseTime("09:75"), null);
});

test("uses half-open intervals so adjacent dock windows do not collide", () => {
  assert.equal(intervalsOverlap(570, 585, 585, 615), false);
  assert.equal(intervalsOverlap(570, 600, 585, 615), true);
});

test("detects the three fixture conflicts", () => {
  const conflicts = detectConflicts(fixtureVenue, initialVendorPlans);
  assert.deepEqual(
    conflicts.map((conflict) => conflict.type).sort(),
    ["ACCESS_BEFORE_OPEN", "DOCK_COLLISION", "POWER_CAPACITY_EXCEEDED"].sort(),
  );
  assert.deepEqual(
    [...conflictedVendorIds(conflicts)].sort(),
    ["field-and-fork", "northstar-av"],
  );
});

test("uses unique, reserved fictional numbers for the demo", () => {
  const demoPhones = initialVendorPlans.map((vendor) => vendor.demoPhone);
  assert.equal(new Set(demoPhones).size, demoPhones.length);
  assert.equal(demoPhones.every((phone) => /^\+120255501(?:21|22|23)$/.test(phone)), true);
});

test("accepts completion exactly at the readiness deadline", () => {
  const conflicts = detectConflicts(fixtureVenue, [initialVendorPlans[0]]);
  assert.equal(
    conflicts.some((conflict) => conflict.type === "SETUP_DEADLINE_MISSED"),
    false,
  );
});

test("never guesses malformed call results", () => {
  const malformed: VendorPlan = {
    ...initialVendorPlans[1],
    id: "malformed",
    arrivalTime: "9ish",
    setupCompleteTime: "unknown",
    powerAmps: -1,
  };
  const conflicts = detectConflicts(fixtureVenue, [malformed]);
  assert.equal(conflicts.filter((conflict) => conflict.type === "UNKNOWN_INPUT").length, 3);
});

test("reconciles the approved fixture resolution", () => {
  const conflicts = detectConflicts(fixtureVenue, resolvedVendorPlans);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(readinessSummary(resolvedVendorPlans, conflicts), {
    readyCount: 3,
    totalCount: 3,
    status: "ready",
  });
});

test("fails closed when readiness is not explicitly ready", () => {
  for (const readiness of ["conditional", "blocked", "unknown", "invalid"] as const) {
    const vendor = {
      ...resolvedVendorPlans[0],
      readiness,
    } as VendorPlan;
    const conflicts = detectConflicts(fixtureVenue, [vendor]);
    assert.equal(
      conflicts.some((conflict) => conflict.type === "READINESS_NOT_CONFIRMED"),
      true,
    );
    assert.equal(readinessSummary([vendor], conflicts).status, "blocked");
  }
});

test("fails closed when the loading-dock requirement is unknown", () => {
  const vendor: VendorPlan = {
    ...resolvedVendorPlans[0],
    needsLoadingDock: "unknown",
  };
  const conflicts = detectConflicts(fixtureVenue, [vendor]);
  assert.equal(conflicts.filter((conflict) => conflict.type === "UNKNOWN_INPUT").length, 1);
  assert.equal(
    conflicts.some((conflict) => conflict.detail.includes("loading-dock requirement")),
    true,
  );
  assert.equal(readinessSummary([vendor], conflicts).status, "blocked");
});

test("fails closed when a ready claim carries a stated blocker", () => {
  const vendor: VendorPlan = {
    ...resolvedVendorPlans[0],
    blocker: "  Waiting on generator approval.  ",
  };
  const conflicts = detectConflicts(fixtureVenue, [vendor]);
  assert.equal(
    conflicts.some((conflict) => conflict.type === "READINESS_NOT_CONFIRMED"),
    true,
  );
  assert.equal(
    conflicts.some((conflict) => conflict.detail.includes("generator approval")),
    true,
  );
  assert.equal(readinessSummary([vendor], conflicts).status, "blocked");
});

test("readiness summary stays blocked on unresolved inputs even without conflicts", () => {
  const unknownDock: VendorPlan = {
    ...resolvedVendorPlans[0],
    needsLoadingDock: "unknown",
  };
  const statedBlocker: VendorPlan = {
    ...resolvedVendorPlans[1],
    blocker: "Crate unopened.",
  };

  assert.equal(readinessSummary([unknownDock], []).status, "blocked");
  assert.equal(readinessSummary([statedBlocker], []).status, "blocked");
});

test("does not report an empty vendor plan as ready", () => {
  assert.deepEqual(readinessSummary([], []), {
    readyCount: 0,
    totalCount: 0,
    status: "blocked",
  });
});
