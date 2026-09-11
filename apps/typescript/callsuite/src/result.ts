export const EXIT_CODE = {
  pass: 0,
  regression: 1,
  needsReview: 2,
  error: 3,
} as const;

export type Verdict = "pass" | "fail" | "needs-review" | "error";
export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export interface ResultInput {
  callStatus: string;
  structuredResult: unknown;
  confidence?: number | null;
  confidenceFloor?: number;
}

export interface NormalizedResult {
  schemaVersion: 1;
  verdict: Verdict;
  exitCode: ExitCode;
  callStatus: string;
  structuredVerdict: string | null;
  confidence: number | null;
  automation: {
    blocked: boolean;
    attribution: "target" | "none";
  };
  reason: string;
}

const PLATFORM_ERROR_STATUSES = new Set([
  "busy",
  "call_failed",
  "canceled",
  "cancelled",
  "declined",
  "error",
  "failed",
  "no_answer",
  "result_invalid",
  "result_unavailable",
  "timed_out",
  "unreachable",
]);

const NON_TERMINAL_STATUSES = new Set([
  "created",
  "in_progress",
  "processing",
  "queued",
  "ringing",
  "scheduled",
]);

const PASS_VERDICTS = new Set(["pass", "passed"]);
const FAIL_VERDICTS = new Set(["fail", "failed", "regression", "target_regression"]);
const REVIEW_VERDICTS = new Set(["inconclusive", "needs_review", "unknown"]);

export function normalizeResult(input: ResultInput): NormalizedResult {
  const callStatus = normalizeToken(input.callStatus);
  const structuredVerdict = readStructuredVerdict(input.structuredResult);
  const confidence = normalizeConfidence(input.confidence);
  const confidenceIsInvalid =
    input.confidence !== undefined &&
    input.confidence !== null &&
    (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1);
  const confidenceFloor = input.confidenceFloor ?? 0.8;

  if (confidenceFloor < 0 || confidenceFloor > 1) {
    throw new RangeError("confidenceFloor must be between 0 and 1.");
  }

  // The call lifecycle is authoritative. A failed call can never become a pass
  // or a workflow regression because an optimistic structured payload survived.
  if (PLATFORM_ERROR_STATUSES.has(callStatus)) {
    return buildResult(
      "error",
      callStatus,
      structuredVerdict,
      confidence,
      `Call ended with platform status '${callStatus}'. The workflow under test is not blamed.`,
    );
  }

  if (NON_TERMINAL_STATUSES.has(callStatus)) {
    return buildResult(
      "needs-review",
      callStatus,
      structuredVerdict,
      confidence,
      `Call status '${callStatus}' is not terminal. Automation is blocked without blaming the workflow.`,
    );
  }

  if (callStatus !== "completed") {
    return buildResult(
      "error",
      callStatus,
      structuredVerdict,
      confidence,
      `Unsupported call status '${callStatus}'. Treating it as a harness/platform error.`,
    );
  }

  if (!structuredVerdict) {
    return buildResult(
      "error",
      callStatus,
      null,
      confidence,
      "Completed call has no readable structured verdict.",
    );
  }

  if (structuredVerdict === "error") {
    return buildResult(
      "error",
      callStatus,
      structuredVerdict,
      confidence,
      "Evaluation reported a harness/platform error. The workflow under test is not blamed.",
    );
  }

  if (REVIEW_VERDICTS.has(structuredVerdict)) {
    return buildResult(
      "needs-review",
      callStatus,
      structuredVerdict,
      confidence,
      "Evaluation was inconclusive. Automation is blocked without blaming the workflow.",
    );
  }

  if (!PASS_VERDICTS.has(structuredVerdict) && !FAIL_VERDICTS.has(structuredVerdict)) {
    return buildResult(
      "error",
      callStatus,
      structuredVerdict,
      confidence,
      `Unsupported structured verdict '${structuredVerdict}'.`,
    );
  }

  if (confidenceIsInvalid) {
    return buildResult(
      "error",
      callStatus,
      structuredVerdict,
      null,
      "Evaluation confidence is outside the supported 0 to 1 range.",
    );
  }

  if (confidence === null) {
    return buildResult(
      "needs-review",
      callStatus,
      structuredVerdict,
      null,
      "Evaluation confidence is missing. Automation is blocked without blaming the workflow.",
    );
  }

  if (confidence < confidenceFloor) {
    return buildResult(
      "needs-review",
      callStatus,
      structuredVerdict,
      confidence,
      `Evaluation confidence ${confidence} is below the ${confidenceFloor} floor.`,
    );
  }

  if (PASS_VERDICTS.has(structuredVerdict)) {
    return buildResult("pass", callStatus, structuredVerdict, confidence, "Workflow behavior passed.");
  }

  if (FAIL_VERDICTS.has(structuredVerdict)) {
    return buildResult(
      "fail",
      callStatus,
      structuredVerdict,
      confidence,
      "Completed call contains a confident workflow regression.",
    );
  }

  throw new Error("Unreachable result-normalization branch.");
}

function buildResult(
  verdict: Verdict,
  callStatus: string,
  structuredVerdict: string | null,
  confidence: number | null,
  reason: string,
): NormalizedResult {
  const exitCode =
    verdict === "pass"
      ? EXIT_CODE.pass
      : verdict === "fail"
        ? EXIT_CODE.regression
        : verdict === "needs-review"
          ? EXIT_CODE.needsReview
          : EXIT_CODE.error;

  return {
    schemaVersion: 1,
    verdict,
    exitCode,
    callStatus,
    structuredVerdict,
    confidence,
    automation: {
      blocked: verdict !== "pass",
      attribution: verdict === "fail" ? "target" : "none",
    },
    reason,
  };
}

function readStructuredVerdict(value: unknown): string | null {
  if (typeof value === "string") return normalizeToken(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  for (const key of ["verdict", "status", "outcome"] as const) {
    if (typeof record[key] === "string") return normalizeToken(record[key]);
  }
  return null;
}

function normalizeConfidence(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[-\s]+/g, "_");
}
