import assert from "node:assert/strict";
import test from "node:test";
import { formatAfterAction, runLocalDemo } from "../demo/demo-flow.js";

test("runLocalDemo completes primary-unavailable-backup-success without hanging", async () => {
  const finished = await runLocalDemo();
  assert.equal(finished.status, "completed");
  assert.equal(finished.attempts.length, 2);
  assert.equal(finished.attempts[0]?.role, "primary");
  assert.equal(finished.attempts[0]?.outcome, "no_answer");
  assert.equal(finished.attempts[1]?.role, "backup");
  assert.equal(finished.attempts[1]?.outcome, "success");
  assert.equal(finished.primary.phone, undefined);
  assert.ok(finished.report);
});

test("formatAfterAction masks phones and omits full E.164", () => {
  const line = formatAfterAction({
    status: "completed",
    attempts: [
      { role: "primary", phoneMasked: "+*******0002", outcome: "no_answer" },
      { role: "backup", phoneMasked: "+*******0003", outcome: "success" },
    ],
    report: { summary: "Scenario production_outage finished in completed." },
  } as Parameters<typeof formatAfterAction>[0]);
  assert.match(line, /\+[*]+0002/);
  assert.match(line, /\+[*]+0003/);
  assert.doesNotMatch(line, /\+1555010000/);
});
