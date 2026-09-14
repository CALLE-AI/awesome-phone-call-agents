import { consentGate, type ConsentRow } from "./consent";

export type VouchSeverity = "confirmed" | "third_party" | "pending" | "blocked";

export function categorizeVouch(
  consent: ConsentRow,
  run?: { status: string; disposition: string | null; resultJson: string | null },
): VouchSeverity {
  const gate = consentGate(consent);
  if (!gate.ok) return "blocked";
  if (!run || run.status !== "terminal") return "pending";
  const result = JSON.parse(run.resultJson ?? "{}") as Record<string, unknown>;
  if (run.disposition === "gatekeeper_refused" || result.refusal_reason === "third_party_only") {
    return "third_party";
  }
  if (result.employment_confirmed === "yes") return "confirmed";
  return "pending";
}