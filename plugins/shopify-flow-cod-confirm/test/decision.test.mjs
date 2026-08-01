import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIdempotencyKey,
  buildTask,
  decide,
  isCashOnDelivery,
  isE164,
  maskDeep,
  maskPhone,
  mergeTags,
  noteFor,
  tagsFor,
  SAFETY_INSTRUCTION,
} from "../src/decision.mjs";

const answered = (structured_result) => ({ status: "completed", structured_result });

test("ship when the customer confirms and the address is correct", () => {
  const verdict = decide(answered({ order_confirmed: true, address_correct: true, cancel_requested: false }));
  assert.equal(verdict.decision, "ship");
  assert.equal(verdict.reason, "confirmed");
});

test("ship when the address was wrong but the customer gave a correction", () => {
  const verdict = decide(
    answered({
      order_confirmed: true,
      address_correct: false,
      corrected_address: "77 Tran Phu, Da Nang",
      cancel_requested: false,
    }),
  );
  assert.equal(verdict.decision, "ship");
  assert.equal(verdict.reason, "confirmed_with_address_correction");
  assert.equal(verdict.correctedAddress, "77 Tran Phu, Da Nang");
});

test("hold when the address is wrong and no correction was captured", () => {
  const verdict = decide(
    answered({ order_confirmed: true, address_correct: false, corrected_address: "", cancel_requested: false }),
  );
  assert.equal(verdict.decision, "hold");
  assert.equal(verdict.reason, "address_wrong_no_correction");
});

test("hold when the customer does not confirm the order", () => {
  const verdict = decide(answered({ order_confirmed: false, address_correct: true, cancel_requested: false }));
  assert.equal(verdict.decision, "hold");
  assert.equal(verdict.reason, "order_not_confirmed");
});

test("cancel request beats a confirmation", () => {
  const verdict = decide(answered({ order_confirmed: true, address_correct: true, cancel_requested: true }));
  assert.equal(verdict.decision, "hold");
  assert.equal(verdict.reason, "customer_cancelled");
});

test("answered with a null structured result is never read as a confirmation", () => {
  const verdict = decide(answered(null));
  assert.equal(verdict.decision, "hold");
  assert.equal(verdict.reason, "answered_no_structured_result");
  assert.equal(verdict.confirmed, false);
});

test("no answer retries once then holds", () => {
  const first = decide({ status: "no_answer" }, { attempt: 1, maxAttempts: 2 });
  assert.equal(first.decision, "retry");
  assert.equal(first.nextAttempt, 2);

  const second = decide({ status: "no_answer" }, { attempt: 2, maxAttempts: 2 });
  assert.equal(second.decision, "hold");
  assert.equal(second.reason, "not_reached:no_answer");
});

test("a cancelled call is never retried", () => {
  const verdict = decide({ status: "canceled" }, { attempt: 1, maxAttempts: 3 });
  assert.equal(verdict.decision, "hold");
});

test("decide refuses a non-terminal status instead of guessing", () => {
  assert.throws(() => decide({ status: "in_progress" }), /terminal call status/);
});

test("idempotency key is stable per shop, order and attempt", () => {
  const a = buildIdempotencyKey({ shopDomain: "s.myshopify.com", orderId: 42 });
  const b = buildIdempotencyKey({ shopDomain: "s.myshopify.com", orderId: 42 });
  const c = buildIdempotencyKey({ shopDomain: "s.myshopify.com", orderId: 42, attempt: 2 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.throws(() => buildIdempotencyKey({ orderId: 42 }), /shopDomain/);
});

test("cash-on-delivery detection accepts Shopify COD spellings and rejects card orders", () => {
  assert.equal(isCashOnDelivery({ gateway: "Cash on Delivery (COD)" }), true);
  assert.equal(isCashOnDelivery({ payment_gateway_names: ["cod"] }), true);
  assert.equal(isCashOnDelivery({ gateway: "shopify_payments", processing_method: "direct" }), false);
});

test("E.164 validation rejects local formats", () => {
  assert.equal(isE164("+15005550100"), true);
  assert.equal(isE164("0342701517"), false);
  assert.equal(isE164("+0123"), false);
});

test("phone numbers are masked in notes and nested objects", () => {
  assert.match(maskPhone("+15005550100"), /^\+150\*+00$/);
  const masked = maskDeep({ nested: { text: "call +15005550100 now" }, list: ["+15005550100"] });
  assert.doesNotMatch(JSON.stringify(masked), /\+15005550100/);
});

test("the note never leaks the full phone number", () => {
  const verdict = decide(answered({ order_confirmed: true, address_correct: true, cancel_requested: false }));
  const note = noteFor(verdict, { callId: "call_1", phone: "+15005550100" });
  assert.doesNotMatch(note, /\+15005550100/);
  assert.match(note, /SHIP/);
});

test("tags are merged without dropping or duplicating merchant tags", () => {
  const verdict = decide(answered({ order_confirmed: true, address_correct: true, cancel_requested: false }));
  const merged = mergeTags("vip-customer, cod-gate", tagsFor(verdict));
  const parts = merged.split(",").map((t) => t.trim());
  assert.ok(parts.includes("vip-customer"));
  assert.ok(parts.includes("cod-ship"));
  assert.equal(parts.filter((t) => t === "cod-gate").length, 1);
});

test("hold tags name the reason so a warehouse can triage without opening the call", () => {
  const verdict = decide(answered({ order_confirmed: false, address_correct: true, cancel_requested: false }));
  // Reasons are slugified so the tag is safe to type into Shopify's tag filter.
  assert.ok(tagsFor(verdict).includes("cod-hold-order-not-confirmed"));
  assert.ok(tagsFor(verdict).includes("cod-hold"));
});

test("the call script identifies the person before disclosing order contents", () => {
  const order = {
    customer: { first_name: "Mai" },
    total_price: "1290000",
    currency: "VND",
    line_items: [{ title: "Wireless earbuds", quantity: 1 }],
    shipping_address: { address1: "128 Nguyen Trai", city: "Ha Noi", country: "Vietnam" },
  };
  const task = buildTask({ order, merchantName: "Demo Store" });
  const askIdentity = task.indexOf("speaking to Mai");
  const discloseItems = task.indexOf("Wireless earbuds");
  assert.ok(askIdentity !== -1 && discloseItems !== -1);
  assert.ok(askIdentity < discloseItems, "identity check must come before order disclosure");
  assert.match(task, /end the call without giving any order details/);
});

test("the safety instruction forbids advice and payment capture", () => {
  assert.match(SAFETY_INSTRUCTION, /medical, legal, financial/);
  assert.match(SAFETY_INSTRUCTION, /Do not take payment details/);
});
