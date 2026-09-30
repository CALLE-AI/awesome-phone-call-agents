import { readFile } from "node:fs/promises";

import { normalizeResult, type NormalizedResult } from "./result.js";
import { assertNoSensitiveContent } from "./sensitive-content.js";
import { evaluateTestCase, type TestCase, type TestCaseReport } from "./test-case.js";

export interface ReplayFixture {
  fixtureVersion: 1;
  sanitization: {
    manuallyReviewed: true;
    containsRawTranscript: false;
    containsRecordingUrl: false;
    containsRealPhoneNumber: false;
  };
  call: {
    id: string;
    status: string;
  };
  evaluation: {
    verdict: string;
    confidence: number | null;
    summary: string;
    /** Optional sanitized structured evidence for deterministic assertions. */
    evidence?: Record<string, unknown>;
  };
}

export interface ReplayOptions {
  testCase?: TestCase;
}

export interface ReplayOutput {
  mode: "replay";
  fixture: {
    id: string;
    path: string;
    summary: string;
  };
  testCase?: TestCaseReport;
  result: NormalizedResult;
}

export async function loadReplay(path: string, options: ReplayOptions = {}): Promise<ReplayOutput> {
  const source = await readFile(path, "utf8");
  const fixture = parseReplayFixture(source, path);

  // Deterministic assertions, not the evaluator's free-form verdict, decide
  // pass/fail whenever a test case is attached.
  const testCaseReport = options.testCase ? evaluateTestCase(options.testCase, fixture.evaluation.evidence) : undefined;
  if (testCaseReport) {
    testCaseReport.evaluatorVerdict = fixture.evaluation.verdict;
  }

  const output: ReplayOutput = {
    mode: "replay",
    fixture: {
      id: fixture.call.id,
      path,
      summary: fixture.evaluation.summary,
    },
    result: normalizeResult({
      callStatus: fixture.call.status,
      structuredResult: { verdict: testCaseReport?.structuredVerdict ?? fixture.evaluation.verdict },
      confidence: fixture.evaluation.confidence,
    }),
  };
  if (testCaseReport) {
    output.testCase = testCaseReport;
  }
  return output;
}

export function parseReplayFixture(source: string, sourceName = "replay fixture"): ReplayFixture {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${sourceName} is not valid JSON: ${message}`);
  }

  assertObject(value, sourceName);
  assertNoSensitiveContent(value, sourceName);

  if (value.fixtureVersion !== 1) {
    throw new Error(`${sourceName} must declare fixtureVersion: 1.`);
  }

  assertObject(value.sanitization, `${sourceName}.sanitization`);
  const sanitization = value.sanitization;
  if (
    sanitization.manuallyReviewed !== true ||
    sanitization.containsRawTranscript !== false ||
    sanitization.containsRecordingUrl !== false ||
    sanitization.containsRealPhoneNumber !== false
  ) {
    throw new Error(
      `${sourceName} must be manually reviewed and declare that it contains no raw transcript, recording URL, or real phone number.`,
    );
  }

  assertObject(value.call, `${sourceName}.call`);
  assertNonEmptyString(value.call.id, `${sourceName}.call.id`);
  assertNonEmptyString(value.call.status, `${sourceName}.call.status`);

  assertObject(value.evaluation, `${sourceName}.evaluation`);
  assertNonEmptyString(value.evaluation.verdict, `${sourceName}.evaluation.verdict`);
  assertNonEmptyString(value.evaluation.summary, `${sourceName}.evaluation.summary`);
  if (
    value.evaluation.confidence !== null &&
    (typeof value.evaluation.confidence !== "number" ||
      !Number.isFinite(value.evaluation.confidence) ||
      value.evaluation.confidence < 0 ||
      value.evaluation.confidence > 1)
  ) {
    throw new Error(`${sourceName}.evaluation.confidence must be null or a number between 0 and 1.`);
  }

  if (value.evaluation.evidence !== undefined) {
    assertEvidence(value.evaluation.evidence, `${sourceName}.evaluation.evidence`);
  }

  return value as unknown as ReplayFixture;
}

/** Evidence is sanitized structured data: strings or string arrays, arbitrarily nested in plain objects. */
function assertEvidence(value: unknown, path: string): void {
  if (typeof value === "string") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      if (typeof child !== "string") {
        throw new Error(`${path}[${index}] must be a string.`);
      }
    });
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertEvidence(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} must contain only strings, string arrays, or nested objects.`);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
}
