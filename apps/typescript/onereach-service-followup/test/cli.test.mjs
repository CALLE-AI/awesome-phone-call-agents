import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
test("default CLI produces an explicitly synthetic result without credentials", () => {
  const output = execFileSync(process.execPath, [cli], { env: {}, encoding: "utf8" });
  const result = JSON.parse(output);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.realCallPlaced, false);
  assert.equal(result.result.outcome, "reschedule_requested");
});
test("live CLI refuses missing authorization before importing the SDK or writing state", () => {
  const result = spawnSync(process.execPath, [cli, "--live"], { env: {}, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live mode requires explicit enablement/);
});
