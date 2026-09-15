import type { CallSnapshot, PurchaseIntent, WorkflowOutcome } from "./types.js";

const OUTCOMES = new Set(["order_requested", "declined", "opted_out", "incomplete", "unknown"]);
const CONFIRMATIONS = new Set(["yes", "no", "unknown"]);
const DELIVERY_METHODS = new Set(["standard", "pickup", "unknown"]);

export function parseIntent(value: Record<string, unknown>): PurchaseIntent | null {
  if (!OUTCOMES.has(String(value.outcome)) || !CONFIRMATIONS.has(String(value.customer_confirmed))) {
    return null;
  }
  if (!DELIVERY_METHODS.has(String(value.delivery_method)) || !Array.isArray(value.items)) {
    return null;
  }
  const items = value.items.map((item) => {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    return typeof record.product_id === "string" && typeof record.quantity === "number"
      ? { product_id: record.product_id, quantity: record.quantity }
      : null;
  });
  if (items.some((item) => item === null)) return null;
  return {
    outcome: String(value.outcome) as PurchaseIntent["outcome"],
    items: items as PurchaseIntent["items"],
    delivery_method: String(value.delivery_method) as PurchaseIntent["delivery_method"],
    ...(typeof value.delivery_detail === "string" ? { delivery_detail: value.delivery_detail } : {}),
    customer_confirmed: String(value.customer_confirmed) as PurchaseIntent["customer_confirmed"],
  };
}

export function assessCallResult(call: CallSnapshot, sessionId: string, recipientPhone: string): WorkflowOutcome {
  const base = { sessionId };
  if (call.status !== "completed") return { ...base, state: "RESULT_REJECTED", reason: "call was not completed" };
  if (call.metadata?.session_id !== sessionId || call.recipientPhone !== recipientPhone) {
    return { ...base, state: "RESULT_REJECTED", reason: "call result is not bound to this workflow recipient" };
  }
  if (call.structuredResult === null) return { ...base, state: "NEEDS_REVIEW", reason: "structured result is missing" };
  const intent = parseIntent(call.structuredResult);
  if (intent === null) return { ...base, state: "NEEDS_REVIEW", reason: "structured result does not match the intent schema" };
  if (intent.outcome === "declined") return { ...base, state: "DECLINED", intent };
  if (intent.outcome === "opted_out") return { ...base, state: "OPTED_OUT", intent };
  if (intent.outcome !== "order_requested" || intent.customer_confirmed !== "yes" || intent.items.length === 0) {
    return { ...base, state: "NEEDS_REVIEW", intent, reason: "purchase intent is incomplete or unconfirmed" };
  }
  return { ...base, state: "INTENT_VALIDATED", intent };
}
