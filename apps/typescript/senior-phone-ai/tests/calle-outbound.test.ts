import assert from "node:assert/strict";
import test from "node:test";

import { outboundCallPreview, validateOutboundCallRequest } from "../lib/calle/outbound";

const validRequest = {
  destinationE164: "+61400000000",
  idempotencyKey: "call-request-123",
  purpose: "Ask whether the recipient can hear clearly.",
};

test("outbound call preview masks the confirmed E.164 destination", () => {
  assert.deepEqual(outboundCallPreview(validRequest), {
    destinationSummary: "[phone ending 0000]",
    purpose: validRequest.purpose,
  });
});

test("outbound calls accept an empty optional purpose without inventing one in review", () => {
  assert.deepEqual(outboundCallPreview({ ...validRequest, purpose: "" }), {
    destinationSummary: "[phone ending 0000]",
    purpose: "No specific purpose",
  });
});

test("outbound calls reject invalid destinations, hidden numbers, and unsafe purposes", () => {
  assert.throws(() => validateOutboundCallRequest({ ...validRequest, destinationE164: "0400 000 000" }));
  assert.throws(() => validateOutboundCallRequest({ ...validRequest, purpose: "Call +61411111111 too." }));
  assert.throws(() => validateOutboundCallRequest({ ...validRequest, purpose: "Give medication change advice." }));
  assert.throws(() => validateOutboundCallRequest({ ...validRequest, idempotencyKey: "short" }));
});
