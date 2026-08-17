/**
 * Assertion engine.
 *
 * Evaluates one check against one terminal call snapshot, deterministically.
 * Transcript text and structured results are untrusted data extracted from a
 * phone conversation: they are compared against expectations and never
 * interpreted as instructions. A check can fail; evaluation itself does not
 * throw on bad data — a wrong shape is a failing assertion with a detail.
 */

import type { Assertion, CheckConfig } from "./config.js";
import { extractTiming, type TimingMetrics } from "./timing.js";
import type { CallSnapshot, TranscriptTurn } from "./types.js";

export interface AssertionResult {
  assertion: Assertion;
  pass: boolean;
  actual: unknown;
  detail: string;
}

export type CheckStatus = "pass" | "fail" | "error";

export interface CheckOutcome {
  checkId: string;
  lineId: string;
  status: CheckStatus;
  callStatus: string;
  assertions: AssertionResult[];
  timing: TimingMetrics;
  timingViolations: string[];
  confidence: number | null;
  confidenceViolation: string | null;
  failureCode: string | null;
  callId: string;
  at: string;
  /** What the canary heard, turn by turn. Older stored outcomes may lack it. */
  transcript?: TranscriptTurn[];
}

const MISSING = Symbol("missing");

function getPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return MISSING;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function evaluateAssertion(assertion: Assertion, result: Record<string, unknown>): AssertionResult {
  const raw = getPath(result, assertion.path);
  const actual = raw === MISSING ? undefined : raw;
  const found = raw !== MISSING;

  if ("exists" in assertion) {
    const pass = found === assertion.exists;
    return { assertion, pass, actual, detail: pass ? "ok" : `${assertion.path} ${found ? "exists" : "is missing"}` };
  }
  if (!found) {
    return { assertion, pass: false, actual, detail: `${assertion.path} is missing from the result` };
  }
  if ("equals" in assertion) {
    const pass = JSON.stringify(actual) === JSON.stringify(assertion.equals);
    return { assertion, pass, actual, detail: pass ? "ok" : `expected ${JSON.stringify(assertion.equals)}, got ${JSON.stringify(actual)}` };
  }
  if ("oneOf" in assertion) {
    const pass = assertion.oneOf.some((candidate) => JSON.stringify(actual) === JSON.stringify(candidate));
    return { assertion, pass, actual, detail: pass ? "ok" : `${JSON.stringify(actual)} is not one of ${JSON.stringify(assertion.oneOf)}` };
  }
  if (typeof actual !== "string") {
    return { assertion, pass: false, actual, detail: `${assertion.path} is not a string` };
  }
  if ("contains" in assertion) {
    const pass = actual.toLowerCase().includes(assertion.contains.toLowerCase());
    return { assertion, pass, actual, detail: pass ? "ok" : `"${actual}" does not contain "${assertion.contains}"` };
  }
  // Cap the subject: transcript fields have no legitimate need to be huge, and
  // an unbounded subject widens the blast radius of any pathological pattern.
  const subject = actual.slice(0, 4096);
  const pass = new RegExp(assertion.matches, "i").test(subject);
  return { assertion, pass, actual, detail: pass ? "ok" : `"${actual}" does not match /${assertion.matches}/i` };
}

export function evaluateCheck(check: CheckConfig, lineId: string, snapshot: CallSnapshot): CheckOutcome {
  const turns = snapshot.recipients[0]?.attempts[0]?.transcriptTurns ?? [];
  const timing = extractTiming(turns);
  const confidence = snapshot.completionConfidence?.score ?? null;
  const at = snapshot.completedAt ?? snapshot.createdAt;
  const base = {
    checkId: check.id,
    lineId,
    callStatus: snapshot.status,
    timing,
    confidence,
    callId: snapshot.id,
    at,
    transcript: turns,
  };

  if (snapshot.status !== "completed") {
    return {
      ...base,
      status: "error",
      assertions: [],
      timingViolations: [],
      confidenceViolation: null,
      failureCode: snapshot.failureCode ?? snapshot.status,
    };
  }
  if (snapshot.structuredResult === null) {
    return {
      ...base,
      status: "error",
      assertions: [],
      timingViolations: [],
      confidenceViolation: null,
      failureCode: snapshot.failureCode ?? "result_validation_failed",
    };
  }

  const assertions = check.assert.map((assertion) => evaluateAssertion(assertion, snapshot.structuredResult!));

  const timingViolations: string[] = [];
  if (check.timing !== undefined) {
    const bounds: { key: "maxSecondsToAnswer" | "maxSecondsToFirstResponse"; metric: keyof TimingMetrics; label: string }[] = [
      { key: "maxSecondsToAnswer", metric: "secondsToAnswer", label: "secondsToAnswer" },
      { key: "maxSecondsToFirstResponse", metric: "secondsToFirstResponse", label: "secondsToFirstResponse" },
    ];
    for (const { key, metric, label } of bounds) {
      const max = check.timing[key];
      if (max === undefined) {
        continue;
      }
      const value = timing[metric] as number | null;
      if (value === null) {
        timingViolations.push(`${label} unmeasurable (no user turn with a timestamp), bound was ${max}`);
      } else if (value > max) {
        timingViolations.push(`${label} ${value} > ${max}`);
      }
    }
  }

  let confidenceViolation: string | null = null;
  if (check.minConfidence !== undefined) {
    if (confidence === null) {
      confidenceViolation = `confidence missing, floor was ${check.minConfidence}`;
    } else if (confidence < check.minConfidence) {
      confidenceViolation = `confidence ${confidence} < ${check.minConfidence}`;
    }
  }

  const failed = assertions.some((entry) => !entry.pass) || timingViolations.length > 0 || confidenceViolation !== null;
  return {
    ...base,
    status: failed ? "fail" : "pass",
    assertions,
    timingViolations,
    confidenceViolation,
    failureCode: null,
  };
}
