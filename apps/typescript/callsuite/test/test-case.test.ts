import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { evaluateTestCase, loadTestCase, parseTestCase, type TestCase } from "../src/test-case.js";

const SAFE_SANITIZATION = {
  manuallyReviewed: true,
  containsRawTranscript: false,
  containsRecordingUrl: false,
  containsRealPhoneNumber: false,
} as const;

function buildTestCase(assertions: unknown): TestCase {
  return {
    testCaseVersion: 1,
    id: "example",
    title: "Example test case",
    sanitization: { ...SAFE_SANITIZATION },
    assertions: assertions as TestCase["assertions"],
  };
}

describe("test-case contract", () => {
  it("loads the committed cancellation-fee test case", async () => {
    const testCase = await loadTestCase(resolve("fixtures/cancellation-fee.test-case.json"));

    assert.equal(testCase.testCaseVersion, 1);
    assert.equal(testCase.id, "cancellation-fee-disclosure");
    assert.equal(testCase.assertions.length, 2);
  });

  it("rejects an invalid JSON document", () => {
    assert.throws(() => parseTestCase("not json"), /not valid JSON/i);
  });

  it("rejects an unsupported contract version", () => {
    const source = JSON.stringify({ ...buildTestCase([]), testCaseVersion: 2 });

    assert.throws(() => parseTestCase(source), /testCaseVersion: 1/);
  });

  it("rejects a test case without manual-sanitization declarations", () => {
    const source = JSON.stringify({
      ...buildTestCase([{ id: "a", path: "mentions", contains: "fee" }]),
      sanitization: { ...SAFE_SANITIZATION, manuallyReviewed: false },
    });

    assert.throws(() => parseTestCase(source), /must be manually reviewed/i);
  });

  it("rejects empty or malformed assertions", () => {
    assert.throws(() => parseTestCase(JSON.stringify(buildTestCase([]))), /non-empty array/i);
    assert.throws(
      () => parseTestCase(JSON.stringify(buildTestCase([{ id: "a", path: "mentions" }]))),
      /contains must be a non-empty string/i,
    );
    assert.throws(
      () => parseTestCase(JSON.stringify(buildTestCase([{ id: "a", path: " ", contains: "fee" }]))),
      /path must be a non-empty string/i,
    );
  });

  it("rejects sensitive content in a test case", () => {
    for (const contains of ["+15550123456", "(+15550123456)", "see +15550123456."]) {
      assert.throws(
        () => parseTestCase(JSON.stringify(buildTestCase([{ id: "a", path: "mentions", contains }]))),
        /phone number/i,
        `expected rejection of: ${contains}`,
      );
    }
    assert.throws(
      () =>
        parseTestCase(
          JSON.stringify({
            ...buildTestCase([{ id: "a", path: "mentions", contains: "fee" }]),
            recordingUrl: "https://example.test/recording/call.mp3",
          }),
        ),
      /prohibited field/i,
    );
  });
});

describe("deterministic assertion evaluation", () => {
  const testCase = buildTestCase([
    { id: "states-cancellation-fee", path: "mentions", contains: "cancellation fee" },
    { id: "confirms-attendance", path: "mentions", contains: "attendance confirmed" },
  ]);

  it("reports met when every required disclosure is present", () => {
    const report = evaluateTestCase(testCase, {
      mentions: ["Attendance confirmed for Thursday", "A CANCELLATION   FEE applies"],
    });

    assert.equal(report.structuredVerdict, "pass");
    assert.equal(report.satisfied, true);
    assert.deepEqual(report.totals, { met: 2, unmet: 0, unknown: 0 });
    assert.deepEqual(
      report.assertions.map((assertion) => assertion.outcome),
      ["met", "met"],
    );
  });

  it("reports unmet when a required disclosure is omitted", () => {
    const report = evaluateTestCase(testCase, { mentions: ["attendance confirmed for thursday"] });

    assert.equal(report.structuredVerdict, "fail");
    assert.equal(report.satisfied, false);
    assert.deepEqual(report.totals, { met: 1, unmet: 1, unknown: 0 });
    assert.equal(report.assertions[0]?.outcome, "unmet");
    assert.equal(report.assertions[1]?.outcome, "met");
  });

  it("lets unknown outweigh unmet so partial evidence never blames the target", () => {
    const partialEvidence = buildTestCase([
      { id: "unmet-assertion", path: "mentions", contains: "cancellation fee" },
      { id: "unknown-assertion", path: "disclosures", contains: "fee" },
    ]);
    const report = evaluateTestCase(partialEvidence, { mentions: ["see you thursday"] });

    assert.deepEqual(report.totals, { met: 0, unmet: 1, unknown: 1 });
    assert.equal(report.structuredVerdict, "inconclusive");
    assert.equal(report.satisfied, false);
  });

  it("reports unknown when evidence is missing or has an unsupported shape", () => {
    const missing = evaluateTestCase(testCase, undefined);
    const wrongShape = evaluateTestCase(testCase, { mentions: 42 });

    for (const report of [missing, wrongShape]) {
      assert.equal(report.structuredVerdict, "inconclusive");
      assert.equal(report.satisfied, false);
      assert.deepEqual(
        report.assertions.map((assertion) => assertion.outcome),
        ["unknown", "unknown"],
      );
    }
  });

  it("resolves dotted paths inside nested evidence objects", () => {
    const nested = buildTestCase([{ id: "nested", path: "disclosures.fees", contains: "cancellation fee" }]);
    const report = evaluateTestCase(nested, { disclosures: { fees: ["cancellation fee applies"] } });
    const missing = evaluateTestCase(nested, { disclosures: { other: ["cancellation fee applies"] } });

    assert.equal(report.assertions[0]?.outcome, "met");
    assert.equal(missing.assertions[0]?.outcome, "unknown");
  });

  it("matches plain-string evidence values as well as arrays", () => {
    const report = evaluateTestCase(buildTestCase([{ id: "a", path: "notes", contains: "cancellation fee" }]), {
      notes: "stated the cancellation fee clearly",
    });

    assert.equal(report.assertions[0]?.outcome, "met");
  });

  it("is deterministic: identical inputs produce identical reports", () => {
    const evidence = { mentions: ["attendance confirmed", "no fee mentioned"] };
    const first = evaluateTestCase(testCase, evidence);
    const second = evaluateTestCase(testCase, evidence);

    assert.deepEqual(first, second);
  });

  it("treats an empty evidence array as unmet rather than unknown", () => {
    const report = evaluateTestCase(buildTestCase([{ id: "a", path: "mentions", contains: "fee" }]), {
      mentions: [],
    });

    assert.equal(report.assertions[0]?.outcome, "unmet");
    assert.equal(report.structuredVerdict, "fail");
  });
});
