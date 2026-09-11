import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { loadReplay, parseReplayFixture } from "../src/replay.js";
import { redactSensitiveContent } from "../src/sensitive-content.js";
import { loadTestCase, type TestCase } from "../src/test-case.js";

const TEST_CASE_PATH = resolve("fixtures/cancellation-fee.test-case.json");

const SAFE_SANITIZATION = {
  manuallyReviewed: true,
  containsRawTranscript: false,
  containsRecordingUrl: false,
  containsRealPhoneNumber: false,
} as const;

describe("replay fixtures", () => {
  it("loads a manually sanitized replay fixture", async () => {
    const output = await loadReplay(resolve("fixtures/pass.sanitized.json"));

    assert.equal(output.mode, "replay");
    assert.equal(output.fixture.id, "sanitized-pass");
    assert.equal(output.result.verdict, "pass");
    assert.equal(output.result.exitCode, 0);
  });

  it("uses terminal status over structured output from a replay", async () => {
    const output = await loadReplay(resolve("fixtures/platform-error.sanitized.json"));

    assert.equal(output.result.structuredVerdict, "pass");
    assert.equal(output.result.verdict, "error");
    assert.equal(output.result.exitCode, 3);
    assert.equal(output.result.automation.attribution, "none");
  });

  it("rejects non-string or non-array evidence values", () => {
    const base = {
      fixtureVersion: 1,
      sanitization: {
        manuallyReviewed: true,
        containsRawTranscript: false,
        containsRecordingUrl: false,
        containsRealPhoneNumber: false,
      },
      call: { id: "evidence", status: "completed" },
      evaluation: { verdict: "pass", confidence: 0.9, summary: "Evidence shape probe." },
    };

    assert.doesNotThrow(() =>
      parseReplayFixture(JSON.stringify({ ...base, evaluation: { ...base.evaluation, evidence: { mentions: ["fee"] } } })),
    );
    assert.throws(
      () => parseReplayFixture(JSON.stringify({ ...base, evaluation: { ...base.evaluation, evidence: { mentions: 7 } } })),
      /strings, string arrays, or nested objects/i,
    );
    assert.throws(
      () =>
        parseReplayFixture(
          JSON.stringify({ ...base, evaluation: { ...base.evaluation, evidence: { mentions: ["fee", 7] } } }),
        ),
      /must be a string/i,
    );
  });

  it("marks a confident broken run as a workflow regression when an assertion is unmet", async () => {
    const testCase = await loadTestCase(TEST_CASE_PATH);
    const output = await loadReplay(resolve("fixtures/broken-omission.sanitized.json"), { testCase });

    assert.equal(output.testCase?.evaluatorVerdict, "pass");
    assert.equal(output.testCase?.structuredVerdict, "fail");
    assert.deepEqual(output.testCase?.totals, { met: 1, unmet: 1, unknown: 0 });
    assert.equal(output.result.verdict, "fail");
    assert.equal(output.result.exitCode, 1);
    assert.deepEqual(output.result.automation, { blocked: true, attribution: "target" });
  });

  it("marks a confident fixed run as a pass when every assertion is met", async () => {
    const testCase = await loadTestCase(TEST_CASE_PATH);
    const output = await loadReplay(resolve("fixtures/fixed-disclosure.sanitized.json"), { testCase });

    assert.equal(output.testCase?.structuredVerdict, "pass");
    assert.deepEqual(output.testCase?.totals, { met: 2, unmet: 0, unknown: 0 });
    assert.equal(output.result.verdict, "pass");
    assert.equal(output.result.exitCode, 0);
    assert.deepEqual(output.result.automation, { blocked: false, attribution: "none" });
  });

  it("keeps a below-floor confident run as needs-review without target blame", async () => {
    const testCase = await loadTestCase(TEST_CASE_PATH);
    const output = await loadReplay(resolve("fixtures/low-confidence.sanitized.json"), { testCase });

    assert.equal(output.testCase?.structuredVerdict, "pass");
    assert.equal(output.result.confidence, 0.72);
    assert.equal(output.result.verdict, "needs-review");
    assert.equal(output.result.exitCode, 2);
    assert.deepEqual(output.result.automation, { blocked: true, attribution: "none" });
  });

  it("lets a terminal platform status override a fully passing assertion set", async () => {
    const testCase = await loadTestCase(TEST_CASE_PATH);
    const output = await loadReplay(resolve("fixtures/platform-failure.sanitized.json"), { testCase });

    assert.equal(output.testCase?.structuredVerdict, "pass");
    assert.equal(output.result.structuredVerdict, "pass");
    assert.equal(output.result.verdict, "error");
    assert.equal(output.result.exitCode, 3);
    assert.deepEqual(output.result.automation, { blocked: true, attribution: "none" });
  });

  it("routes mixed unmet and unknown evidence to needs-review without target blame", async () => {
    const partialEvidenceTestCase: TestCase = {
      testCaseVersion: 1,
      id: "partial-evidence",
      title: "Partial evidence probe",
      sanitization: { ...SAFE_SANITIZATION },
      assertions: [
        { id: "absent-disclosure", path: "mentions", contains: "24-hour notice policy" },
        { id: "missing-evidence", path: "disclosures", contains: "fee" },
      ],
    };
    const output = await loadReplay(resolve("fixtures/fixed-disclosure.sanitized.json"), {
      testCase: partialEvidenceTestCase,
    });

    assert.deepEqual(output.testCase?.totals, { met: 0, unmet: 1, unknown: 1 });
    assert.equal(output.testCase?.structuredVerdict, "inconclusive");
    assert.equal(output.result.confidence, 0.96);
    assert.equal(output.result.verdict, "needs-review");
    assert.equal(output.result.exitCode, 2);
    assert.deepEqual(output.result.automation, { blocked: true, attribution: "none" });
  });

  it("routes unknown evidence to needs-review without target blame", async () => {
    const testCase = await loadTestCase(TEST_CASE_PATH);
    const output = await loadReplay(resolve("fixtures/pass.sanitized.json"), { testCase });

    assert.equal(output.testCase?.structuredVerdict, "inconclusive");
    assert.equal(output.result.verdict, "needs-review");
    assert.equal(output.result.exitCode, 2);
    assert.deepEqual(output.result.automation, { blocked: true, attribution: "none" });
  });

  it("keeps the legacy evaluation-verdict path unchanged without a test case", async () => {
    const withEvaluatorVerdict = await loadReplay(resolve("fixtures/broken-omission.sanitized.json"));

    assert.equal(withEvaluatorVerdict.testCase, undefined);
    assert.equal(withEvaluatorVerdict.result.verdict, "pass");
    assert.equal(withEvaluatorVerdict.result.exitCode, 0);
  });

  it("rejects fixtures without an explicit manual-sanitization declaration", () => {
    const source = JSON.stringify({
      fixtureVersion: 1,
      sanitization: {
        manuallyReviewed: false,
        containsRawTranscript: false,
        containsRecordingUrl: false,
        containsRealPhoneNumber: false,
      },
      call: { id: "unsafe", status: "completed" },
      evaluation: { verdict: "pass", confidence: 1, summary: "Unsafe fixture." },
    });

    assert.throws(() => parseReplayFixture(source), /must be manually reviewed/i);
  });

  it("rejects transcript fields, recording links, and E.164-like values", () => {
    const base = {
      fixtureVersion: 1,
      sanitization: {
        manuallyReviewed: true,
        containsRawTranscript: false,
        containsRecordingUrl: false,
        containsRealPhoneNumber: false,
      },
      call: { id: "unsafe", status: "completed" },
      evaluation: { verdict: "pass", confidence: 1, summary: "Unsafe fixture." },
    };

    assert.throws(
      () => parseReplayFixture(JSON.stringify({ ...base, transcript: "raw text" })),
      /prohibited field/i,
    );
    assert.throws(
      () => parseReplayFixture(JSON.stringify({ ...base, leak: "https://example.test/recording/unsafe.mp3" })),
      /recording-like URL/i,
    );
    assert.throws(
      () => parseReplayFixture(JSON.stringify({ ...base, leak: "+15550123456" })),
      /phone number/i,
    );
  });

  it("rejects E.164-like values wrapped in punctuation", () => {
    const base = {
      fixtureVersion: 1,
      sanitization: {
        manuallyReviewed: true,
        containsRawTranscript: false,
        containsRecordingUrl: false,
        containsRealPhoneNumber: false,
      },
      call: { id: "unsafe", status: "completed" },
      evaluation: { verdict: "pass", confidence: 1, summary: "Unsafe fixture." },
    };
    const punctuated = [
      "(+15550123456)",
      '"+15550123456"',
      "call +15550123456, then wait",
      "the number is +15550123456.",
      "[+15550123456]",
    ];

    for (const leak of punctuated) {
      assert.throws(
        () => parseReplayFixture(JSON.stringify({ ...base, leak })),
        /phone number/i,
        `expected rejection of: ${leak}`,
      );
    }
  });

  it("deeply masks common phone formats and exact secrets in provider output", () => {
    const safe = redactSensitiveContent(
      {
        error: "Provider rejected +1 (555) 010-1234 for key secret-value.",
        evidence: ["Call 555.010.5678", { transcript: "My local number is 555 010 9999." }],
        recording: "https://provider.example/recording/private.mp3",
      },
      ["secret-value"],
    );

    assert.deepEqual(safe, {
      error: "Provider rejected [PHONE REDACTED] for key [REDACTED].",
      evidence: ["Call [PHONE REDACTED]", { transcript: "My local number is [PHONE REDACTED]." }],
      recording: "[RECORDING URL REDACTED]",
    });
  });

  it("keeps short reference numbers readable during output redaction", () => {
    assert.equal(redactSensitiveContent("Case NBS-88213 is due Thursday."), "Case NBS-88213 is due Thursday.");
  });
});
