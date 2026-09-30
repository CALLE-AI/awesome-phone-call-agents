import assert from "node:assert/strict";
import test from "node:test";
import { CalleClient } from "@call-e/calle";
import { offerSchema, sanitizeOffers } from "../public/js/comparison.js";
import { assertCalleSchema } from "./calle-schema-contract.js";

test("installed SDK sends a recipient-only schema using CALL-E's documented subset", async () => {
  const schema = { type: "object", additionalProperties: false, properties: { offers: offerSchema } };
  let requests = 0;
  const client = new CalleClient({ apiKey: "mock-key", fetch: async request => {
    requests++;
    const body = await request.json();
    assert.equal(Object.hasOwn(body, "result_schema"), false);
    assert.deepEqual(body.recipients, [{ phones: ["+12025550123"] }]);
    assertCalleSchema(body.recipient_result_schema);
    assert.equal(request.headers.get("Idempotency-Key"), "schema-contract-check");
    return new globalThis.Response(JSON.stringify({ id: "call_contract", status: "queued", recipients: [] }), { status: 201, headers: { "Content-Type": "application/json" } });
  } });
  const created = await client.calls.create({ task: "Test contract", recipients: [{ phone: "+12025550123" }], recipientResultSchema: schema }, { idempotencyKey: "schema-contract-check" });
  assert.equal(created.id, "call_contract");
  assert.equal(requests, 1);
});

test("omitted provider numbers remain unknown locally and the three-offer cap is enforced locally", () => {
  for (const name of ["price", "quantity", "availableQuantity"]) {
    assert.equal(offerSchema.items.required.includes(name), false);
    assert.equal(offerSchema.items.properties[name].type, "number");
  }
  const offers = sanitizeOffers(Array.from({ length: 5 }, () => ({ medicine: "Example" })));
  assert.equal(offers.length, 3);
  assert.equal(offers[0].price, null);
  assert.equal(offers[0].quantity, null);
  assert.equal(offers[0].availableQuantity, null);
});
