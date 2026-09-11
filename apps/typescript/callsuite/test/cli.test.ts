import assert from "node:assert/strict";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

describe("replay CLI", () => {
  const cases = [
    ["pass.sanitized.json", 0, "pass"],
    ["regression.sanitized.json", 1, "fail"],
    ["needs-review.sanitized.json", 2, "needs-review"],
    ["platform-error.sanitized.json", 3, "error"],
  ] as const;

  for (const [fixture, exitCode, verdict] of cases) {
    it(`returns exit ${exitCode} for ${verdict}`, () => {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", resolve("src/cli.ts"), "replay", resolve("fixtures", fixture), "--json"],
        { encoding: "utf8" },
      );

      assert.equal(result.status, exitCode, result.stderr);
      assert.equal(result.signal, null);
      const output = JSON.parse(result.stdout) as {
        result: { verdict: string; exitCode: number; automation: { attribution: string } };
      };
      assert.equal(output.result.verdict, verdict);
      assert.equal(output.result.exitCode, exitCode);
      assert.equal(output.result.automation.attribution, exitCode === 1 ? "target" : "none");
    });
  }
});

describe("replay CLI with a JSON test case", () => {
  const testCasePath = resolve("fixtures/cancellation-fee.test-case.json");
  const cases = [
    ["fixed-disclosure.sanitized.json", 0, "pass"],
    ["broken-omission.sanitized.json", 1, "fail"],
    ["low-confidence.sanitized.json", 2, "needs-review"],
    ["platform-failure.sanitized.json", 3, "error"],
  ] as const;

  for (const [fixture, exitCode, verdict] of cases) {
    it(`returns exit ${exitCode} for ${verdict} when assertions drive the verdict`, () => {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src/cli.ts"),
          "replay",
          resolve("fixtures", fixture),
          "--test-case",
          testCasePath,
          "--json",
        ],
        { encoding: "utf8" },
      );

      assert.equal(result.status, exitCode, result.stderr);
      assert.equal(result.signal, null);
      const output = JSON.parse(result.stdout) as {
        testCase: {
          id: string;
          structuredVerdict: string;
          assertions: { id: string; outcome: string }[];
        };
        result: { verdict: string; exitCode: number; automation: { blocked: boolean; attribution: string } };
      };
      assert.equal(output.testCase.id, "cancellation-fee-disclosure");
      assert.equal(output.testCase.assertions.length, 2);
      assert.equal(output.result.verdict, verdict);
      assert.equal(output.result.exitCode, exitCode);
      assert.equal(output.result.automation.attribution, exitCode === 1 ? "target" : "none");
      assert.equal(output.result.automation.blocked, exitCode !== 0);
    });
  }

  it("fails safely when --test-case is missing its path argument", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("src/cli.ts"), "replay", resolve("fixtures/pass.sanitized.json"), "--test-case"],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 3);
    assert.match(result.stderr, /--test-case requires a test-case JSON path/i);
  });

  it("rejects another flag as the value of --test-case or --html", () => {
    const flagValues = [
      [["--test-case", "--json"], /--test-case requires a test-case JSON path/i],
      [["--html", "--json"], /--html requires an output path/i],
    ] as const;

    for (const [optionArgs, pattern] of flagValues) {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", resolve("src/cli.ts"), "replay", resolve("fixtures/pass.sanitized.json"), ...optionArgs],
        { encoding: "utf8" },
      );

      assert.equal(result.status, 3);
      assert.match(result.stderr, pattern);
    }
  });
});
