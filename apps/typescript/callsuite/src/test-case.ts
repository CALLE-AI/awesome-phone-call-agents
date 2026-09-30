import { readFile } from "node:fs/promises";

import { assertNoSensitiveContent } from "./sensitive-content.js";

/**
 * The minimal, stable JSON test-case contract. A test case declares which
 * sanitized structured-result evidence a CALL-E workflow must produce. There is
 * intentionally one assertion operator (`contains`) so outcomes stay
 * deterministic and reviewable.
 */
export interface TestCase {
  testCaseVersion: 1;
  id: string;
  title: string;
  sanitization: {
    manuallyReviewed: true;
    containsRawTranscript: false;
    containsRecordingUrl: false;
    containsRealPhoneNumber: false;
  };
  assertions: TestCaseAssertion[];
}

export interface TestCaseAssertion {
  id: string;
  /** Dotted path inside the fixture's `evaluation.evidence` object. */
  path: string;
  /** Normalized substring that must appear in the evidence at `path`. */
  contains: string;
}

export type AssertionOutcome = "met" | "unmet" | "unknown";

export interface AssertionReportEntry extends TestCaseAssertion {
  outcome: AssertionOutcome;
}

export interface TestCaseReport {
  id: string;
  title: string;
  /** The evaluator verdict carried by the fixture, kept for transparency only. */
  evaluatorVerdict: string;
  assertions: AssertionReportEntry[];
  satisfied: boolean;
  /** Structured verdict derived from assertions and fed into normalization. */
  structuredVerdict: "pass" | "fail" | "inconclusive";
  totals: { met: number; unmet: number; unknown: number };
}

export async function loadTestCase(path: string): Promise<TestCase> {
  const source = await readFile(path, "utf8");
  return parseTestCase(source, path);
}

export function parseTestCase(source: string, sourceName = "test case"): TestCase {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${sourceName} is not valid JSON: ${message}`);
  }

  assertObject(value, sourceName);
  assertNoSensitiveContent(value, sourceName);

  if (value.testCaseVersion !== 1) {
    throw new Error(`${sourceName} must declare testCaseVersion: 1.`);
  }

  assertNonEmptyString(value.id, `${sourceName}.id`);
  assertNonEmptyString(value.title, `${sourceName}.title`);

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

  if (!Array.isArray(value.assertions) || value.assertions.length === 0) {
    throw new Error(`${sourceName}.assertions must be a non-empty array.`);
  }

  value.assertions.forEach((assertion, index) => {
    const assertionPath = `${sourceName}.assertions[${index}]`;
    assertObject(assertion, assertionPath);
    assertNonEmptyString(assertion.id, `${assertionPath}.id`);
    assertNonEmptyString(assertion.path, `${assertionPath}.path`);
    assertNonEmptyString(assertion.contains, `${assertionPath}.contains`);
  });

  return value as unknown as TestCase;
}

/**
 * Deterministically evaluates assertions against the sanitized evidence of a
 * replay fixture. Pure: the same test case and evidence always produce the
 * same report.
 */
export function evaluateTestCase(testCase: TestCase, evidence: unknown): TestCaseReport {
  const assertions = testCase.assertions.map((assertion) => ({
    ...assertion,
    outcome: evaluateAssertion(assertion, evidence),
  }));

  const totals = { met: 0, unmet: 0, unknown: 0 };
  for (const assertion of assertions) {
    totals[assertion.outcome] += 1;
  }

  // Missing evidence must never blame the target: any unknown assertion makes
  // the run inconclusive, even when another assertion is unmet.
  const structuredVerdict = totals.unknown > 0 ? "inconclusive" : totals.unmet > 0 ? "fail" : "pass";

  return {
    id: testCase.id,
    title: testCase.title,
    evaluatorVerdict: "",
    assertions,
    satisfied: totals.unmet === 0 && totals.unknown === 0,
    structuredVerdict,
    totals,
  };
}

function evaluateAssertion(assertion: TestCaseAssertion, evidence: unknown): AssertionOutcome {
  const value = resolveEvidencePath(evidence, assertion.path);
  const candidates =
    typeof value === "string"
      ? [value]
      : Array.isArray(value) && value.every((item) => typeof item === "string")
        ? (value as string[])
        : null;

  if (candidates === null) {
    return "unknown";
  }

  const needle = normalizeText(assertion.contains);
  return candidates.some((candidate) => normalizeText(candidate).includes(needle)) ? "met" : "unmet";
}

function resolveEvidencePath(evidence: unknown, path: string): unknown {
  let current = evidence;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Case- and whitespace-insensitive matching keeps results deterministic. */
function normalizeText(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, " ");
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
