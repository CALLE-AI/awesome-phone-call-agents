import assert from "node:assert/strict";
import test from "node:test";
import { CalleCallError, callFromFixture, type CallePort } from "../src/calle.js";
import { DemoCommerce } from "../src/commerce.js";
import { ConversactOrchestrator } from "../src/orchestrator.js";
import { DemoPayment } from "../src/payment.js";
import type { CallConsent, CallPlan, CallSnapshot, Product } from "../src/types.js";

const sessionId = "cv_test_001";
const phone = "+14155550100";
const consent: CallConsent = { sessionId, recipientPhone: phone, purpose: "conversational_checkout", authorizedAt: "2026-01-01T00:00:00.000Z" };
const catalog: Product[] = [{ id: "coffee-small", name: "Small Coffee", priceMinor: 350, currency: "USD", active: true, stock: 5 }];
const intent = { outcome: "order_requested" as const, items: [{ product_id: "coffee-small", quantity: 2 }], delivery_method: "pickup" as const, customer_confirmed: "yes" as const };

test("same session creates one quote and one synthetic payment handoff", async () => {
  const workflow = new ConversactOrchestrator(new DemoCommerce(catalog), new DemoPayment());
  const call = callFromFixture(sessionId, phone, intent);
  const first = await workflow.reconcile(consent, call);
  const replay = await workflow.reconcile(consent, call);
  assert.equal(first.state, "PAYMENT_HANDOFF_CREATED");
  assert.equal(replay.payment?.reference, first.payment?.reference);
  assert.equal(replay.quote?.quoteId, first.quote?.quoteId);
});

test("ambiguous provider submission stops without an automatic redial", async () => {
  let creates = 0;
  const fake: CallePort = {
    async createCall(_plan: CallPlan): Promise<CallSnapshot> {
      creates += 1;
      throw new CalleCallError("connection_lost", "connection lost");
    },
    async waitForResult(_callId: string): Promise<CallSnapshot> {
      throw new Error("not reached");
    },
  };
  const workflow = new ConversactOrchestrator(new DemoCommerce(catalog), new DemoPayment());
  const outcome = await workflow.startLive(consent, { task: "test", recipients: [{ phones: [phone] }], resultSchema: { type: "object" }, metadata: { session_id: sessionId }, idempotencyKey: "conversact:cv_test_001:call:v1" }, fake);
  assert.equal(creates, 1);
  assert.equal(outcome.state, "CALL_AMBIGUOUS");
});
