import { normalizeResult, type NormalizedResult } from "./result.js";

export type DisclosureVerdict = "pass" | "fail" | "needs-review";

export function normalizeLiveExecutionError(): NormalizedResult {
  return normalizeResult({
    callStatus: "error",
    structuredResult: null,
    confidence: null,
  });
}

export function cancellationDisclosureToVerdict(structuredResult: unknown): DisclosureVerdict {
  if (!structuredResult || typeof structuredResult !== "object" || Array.isArray(structuredResult)) {
    return "needs-review";
  }

  const outcome = (structuredResult as Record<string, unknown>).cancellation_fee_disclosed;
  if (outcome === "yes") return "pass";
  if (outcome === "no") return "fail";
  return "needs-review";
}
