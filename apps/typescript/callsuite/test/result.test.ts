import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXIT_CODE, normalizeResult } from "../src/result.js";

describe("normalizeResult", () => {
  it("maps a confident completed pass to exit code 0", () => {
    const result = normalizeResult({
      callStatus: "completed",
      structuredResult: { verdict: "pass" },
      confidence: 0.96,
    });

    assert.equal(result.verdict, "pass");
    assert.equal(result.exitCode, EXIT_CODE.pass);
    assert.deepEqual(result.automation, { blocked: false, attribution: "none" });
  });

  it("maps a confident completed failure to workflow-regression exit code 1", () => {
    const result = normalizeResult({
      callStatus: "completed",
      structuredResult: { verdict: "fail" },
      confidence: 0.91,
    });

    assert.equal(result.verdict, "fail");
    assert.equal(result.exitCode, EXIT_CODE.regression);
    assert.deepEqual(result.automation, { blocked: true, attribution: "target" });
  });

  it("lets a terminal call failure override a confident structured pass", () => {
    const result = normalizeResult({
      callStatus: "timed_out",
      structuredResult: { verdict: "pass" },
      confidence: 1,
    });

    assert.equal(result.verdict, "error");
    assert.equal(result.exitCode, EXIT_CODE.error);
    assert.deepEqual(result.automation, { blocked: true, attribution: "none" });
    assert.match(result.reason, /workflow under test is not blamed/i);
  });

  it("blocks low-confidence and inconclusive results without target blame", () => {
    const lowConfidence = normalizeResult({
      callStatus: "completed",
      structuredResult: { verdict: "fail" },
      confidence: 0.4,
    });
    const inconclusive = normalizeResult({
      callStatus: "completed",
      structuredResult: { verdict: "inconclusive" },
      confidence: 0.99,
    });

    for (const result of [lowConfidence, inconclusive]) {
      assert.equal(result.verdict, "needs-review");
      assert.equal(result.exitCode, EXIT_CODE.needsReview);
      assert.deepEqual(result.automation, { blocked: true, attribution: "none" });
    }
  });

  it("maps an evaluation error to exit code 3 without target blame", () => {
    const result = normalizeResult({
      callStatus: "completed",
      structuredResult: { verdict: "error" },
      confidence: 0.99,
    });

    assert.equal(result.verdict, "error");
    assert.equal(result.exitCode, EXIT_CODE.error);
    assert.equal(result.automation.attribution, "none");
  });

  it("treats unsupported result contracts as harness errors", () => {
    const unknownVerdict = normalizeResult({
      callStatus: "completed",
      structuredResult: { verdict: "maybe-ish" },
      confidence: 0.2,
    });
    const invalidConfidence = normalizeResult({
      callStatus: "completed",
      structuredResult: { verdict: "pass" },
      confidence: 2,
    });

    for (const result of [unknownVerdict, invalidConfidence]) {
      assert.equal(result.verdict, "error");
      assert.equal(result.exitCode, EXIT_CODE.error);
      assert.equal(result.automation.attribution, "none");
    }
  });
});
