import type { Call } from "@call-e/calle";
import type { ReadinessAnswer } from "./types.js";

export type GateResult =
  | { verified: true; callId: string; answer: ReadinessAnswer; confidence: string }
  | { verified: false; callId: string; answer: ReadinessAnswer | null; reason: string };

const ENUMS: Record<string, readonly string[]> = {
  reached_recipient: ["yes", "no", "unknown"],
  readiness: ["ready_now", "within_15_min", "15_to_45_min", "later_today", "not_today", "unknown"],
  handoff: ["in_person", "guard_or_neighbor", "none", "unknown"],
  cod_cash_ready: ["yes", "no", "not_applicable", "unknown"],
};
const TEXT_FIELDS = ["ready_clock_time", "landmark", "customer_quote", "quote_in_english"];
const TRUSTED_CONFIDENCE = new Set(["high", "medium"]);

/**
 * Decides whether a finished call may change the route. Anything short of a
 * completed call to the planned number, a reached customer, their own words,
 * a stated time and a confident judgment is unverified and changes nothing.
 */
export function gateCall(call: Call, plannedPhone: string): GateResult {
  const unverified = (reason: string, answer: ReadinessAnswer | null = null): GateResult => ({
    verified: false,
    callId: call.id,
    answer,
    reason,
  });

  if (call.status !== "completed") {
    const code = call.failureCode ? ` (${call.failureCode.replace(/_/g, " ")})` : "";
    return unverified(`call ${call.status}${code}`);
  }
  const recipient = call.recipients[0];
  if (!recipient) return unverified("no recipient in the result");
  if (!recipient.phones.includes(plannedPhone)) return unverified("result is for a different number");

  const answer = parseAnswer(recipient.structuredResult);
  if (!answer) return unverified("result missing or outside the schema");
  if (answer.reached_recipient !== "yes") return unverified("customer not reached", answer);
  if (!answer.customer_quote.trim()) return unverified("no words from the customer to back the answer", answer);
  if (answer.readiness === "unknown") return unverified("customer did not say when", answer);

  const confidence = call.completionConfidence?.label?.toLowerCase() ?? "missing";
  if (!TRUSTED_CONFIDENCE.has(confidence)) return unverified(`CALL-E confidence ${confidence}`, answer);

  return { verified: true, callId: call.id, answer, confidence };
}

/** Strictly validates a structured result; returns null for anything unexpected. */
export function parseAnswer(value: unknown): ReadinessAnswer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (typeof record[field] !== "string" || !allowed.includes(record[field] as string)) return null;
  }
  for (const field of TEXT_FIELDS) {
    if (typeof record[field] !== "string") return null;
  }
  return record as unknown as ReadinessAnswer;
}
