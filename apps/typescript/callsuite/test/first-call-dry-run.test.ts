import assert from "node:assert/strict";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  cancellationDisclosureToVerdict,
  normalizeLiveExecutionError,
} from "../src/first-call-scenario.js";
import { loadCallTask } from "../src/call-task.js";

const fictionalTarget = "+15550101234";
const alternateFictionalTarget = "+15550105678";

describe("first-call authorization preflight", () => {
  it("accepts an exact authorized target in dry-run mode without a call", () => {
    const result = runDryRun(fictionalTarget, fictionalTarget, "good");

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY RUN — no call/);
    assert.match(result.stdout, /Variant: good/);
    assert.match(result.stdout, /cancellation_fee_disclosed/);
    assert.match(result.stdout, /No network request or phone call was made/);
    assert.doesNotMatch(result.stdout, new RegExp(fictionalTarget.replace("+", "\\+")));
  });

  it("rejects an unauthorized target before client creation", () => {
    const result = runDryRun(fictionalTarget, alternateFictionalTarget, "good");

    assert.equal(result.status, 3);
    assert.match(result.stderr, /not present.*No call was placed/i);
    assert.doesNotMatch(result.stderr, new RegExp(fictionalTarget.replace("+", "\\+")));
  });

  it("keeps both outbound reminder tasks self-contained", async () => {
    for (const variant of ["good", "concise-regression"] as const) {
      const task = await loadCallTask(variant);
      assert.match(task.content, /Aarav Mehta/);
      assert.match(task.content, /Cedar Clinic/);
      assert.match(task.content, /Thursday at 4:00 PM/);
      assert.match(task.content, /ask whether they will attend/i);
    }
  });

  it("maps live execution failures to a no-blame harness error", () => {
    const result = normalizeLiveExecutionError();

    assert.equal(result.verdict, "error");
    assert.equal(result.exitCode, 3);
    assert.deepEqual(result.automation, { blocked: true, attribution: "none" });
  });

  it("maps fee disclosure instead of task completion to the workflow verdict", () => {
    assert.equal(cancellationDisclosureToVerdict({ cancellation_fee_disclosed: "yes" }), "pass");
    assert.equal(cancellationDisclosureToVerdict({ cancellation_fee_disclosed: "no" }), "fail");
    assert.equal(cancellationDisclosureToVerdict({ cancellation_fee_disclosed: "unknown" }), "needs-review");
    assert.equal(cancellationDisclosureToVerdict(null), "needs-review");
  });

  it("requires an explicit task variant and rejects unknown arguments", () => {
    const missing = runDryRun(fictionalTarget, fictionalTarget);
    assert.equal(missing.status, 3);
    assert.match(missing.stderr, /--variant requires/);

    const misspelled = runDryRun(fictionalTarget, fictionalTarget, "good", ["--varaint"]);
    assert.equal(misspelled.status, 3);
    assert.match(misspelled.stderr, /Unknown argument '--varaint'/);
  });
});

function runDryRun(
  target: string,
  authorizedTargets: string,
  variant?: "good" | "concise-regression",
  extraArgs: string[] = [],
) {
  const args = ["--import", "tsx", resolve("src/first-call.ts"), "--dry-run"];
  if (variant) args.push("--variant", variant);
  args.push(...extraArgs);
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      CALLE_API_KEY: "test-only-key",
      CALLSUITE_TEST_PHONE: target,
      CALLSUITE_AUTHORIZED_TARGETS: authorizedTargets,
      CALLSUITE_TEST_REGION: "US",
      CALLSUITE_TEST_LOCALE: "en-US",
    },
  });
}
