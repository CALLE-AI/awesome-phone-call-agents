export type Decision = "yes" | "no" | "unknown";

export function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function safeDecision(value: unknown): Decision {
  return value === "yes" || value === "no" ? value : "unknown";
}

export function safeConfidence(value: unknown) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

export function mapStructuredResult(value: Record<string, unknown> | null | undefined) {
  return {
    decision: safeDecision(value?.decision),
    confidence: safeConfidence(value?.confidence),
    summary: safeString(value?.summary),
    followUp: safeDecision(value?.follow_up_required),
  };
}
