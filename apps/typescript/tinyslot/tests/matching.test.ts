import assert from "node:assert/strict";
import test from "node:test";
import { campaignSummary, evaluateCenter, nextWave } from "../lib/matching.ts";
import { fixtureBrief, fixtureCandidates, fixtureResults, initialRecords } from "../lib/fixtures.ts";

test("qualifies only a center that satisfies every hard constraint", () => {
  const evaluation = evaluateCenter(fixtureCandidates[0], fixtureResults["willow-room"], fixtureBrief);
  assert.equal(evaluation.tier, "qualified");
  assert.equal(evaluation.checks.some((item) => item.status === "fail"), false);
  assert.ok(evaluation.score >= 80);
});

test("keeps a waitlist separate from an opening", () => {
  const evaluation = evaluateCenter(fixtureCandidates[2], fixtureResults["moss-and-moon"], fixtureBrief);
  assert.equal(evaluation.tier, "waitlist");
  assert.equal(evaluation.checks.find((item) => item.key === "vacancy")?.status, "fail");
});

test("does not qualify a center missing required weekdays", () => {
  const evaluation = evaluateCenter(fixtureCandidates[3], fixtureResults["little-atlas"], fixtureBrief);
  assert.equal(evaluation.tier, "partial");
  assert.equal(evaluation.checks.find((item) => item.key === "days")?.status, "fail");
});

test("routes missing evidence to review instead of guessing", () => {
  const result = { ...fixtureResults["willow-room"], scheduleEvidence: "" };
  const evaluation = evaluateCenter(fixtureCandidates[0], result, fixtureBrief);
  assert.equal(evaluation.tier, "review");
  assert.equal(evaluation.checks.find((item) => item.key === "evidence")?.status, "unknown");
});

test("stops the campaign and counts untouched centers after target is met", () => {
  const records = initialRecords.map((record) => {
    if (!["willow-room", "alder-house", "moss-and-moon"].includes(record.candidateId)) return record;
    return { ...record, status: "completed" as const, result: fixtureResults[record.candidateId] };
  });
  const summary = campaignSummary(fixtureCandidates, records, fixtureBrief);
  assert.equal(summary.targetMet, true);
  assert.equal(summary.qualified, 2);
  assert.equal(summary.callsAvoided, 3);
  assert.deepEqual(nextWave(records, 3, summary.targetMet), []);
});

test("selects a bounded next wave when the target is not met", () => {
  assert.deepEqual(nextWave(initialRecords, 2, false), ["willow-room", "alder-house"]);
  assert.equal(nextWave(initialRecords, 50, false).length, 3);
});
