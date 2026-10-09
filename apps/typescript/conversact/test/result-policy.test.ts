import assert from "node:assert/strict";
import test from "node:test";
import { assessCallResult } from "../src/result-policy.js";
import type { CallSnapshot } from "../src/types.js";

const sessionId = "cv_test_001";
const phone = "+14155550100";
const call = (structuredResult: Record<string, unknown> | null, status = "completed"): CallSnapshot => ({
  id: "call_test_001",
  status,
  metadata: { session_id: sessionId },
  recipientPhone: phone,
  structuredResult,
});

test("a completed call alone does not create an order", () => {
  assert.equal(assessCallResult(call(null), sessionId, phone).state, "NEEDS_REVIEW");
  assert.equal(assessCallResult(call({ outcome: "order_requested", items: [], delivery_method: "pickup", customer_confirmed: "unknown" }), sessionId, phone).state, "NEEDS_REVIEW");
  assert.equal(assessCallResult(call({ outcome: "declined", items: [], delivery_method: "unknown", customer_confirmed: "no" }), sessionId, phone).state, "DECLINED");
  assert.equal(assessCallResult(call({ outcome: "opted_out", items: [], delivery_method: "unknown", customer_confirmed: "no" }), sessionId, phone).state, "OPTED_OUT");
  assert.equal(assessCallResult(call(null, "failed"), sessionId, phone).state, "RESULT_REJECTED");
});

test("a confirmed schema-valid order is accepted only when bound to this recipient", () => {
  const intent = { outcome: "order_requested", items: [{ product_id: "coffee-small", quantity: 1 }], delivery_method: "pickup", customer_confirmed: "yes" };
  assert.equal(assessCallResult(call(intent), sessionId, phone).state, "INTENT_VALIDATED");
  assert.equal(assessCallResult({ ...call(intent), recipientPhone: "+14155550101" }, sessionId, phone).state, "RESULT_REJECTED");
});
