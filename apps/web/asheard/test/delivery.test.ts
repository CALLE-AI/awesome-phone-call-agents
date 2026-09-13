import assert from "node:assert/strict";
import test from "node:test";

import { callIdFrom, eventIdFrom } from "../src/lib/delivery.ts";

test("the call id is taken from a webhook envelope or a bare call", () => {
  assert.equal(
    callIdFrom({ id: "evt_abc123def456", type: "call.completed", data: { id: "call_abcdef123456" } }),
    "call_abcdef123456",
  );
  assert.equal(callIdFrom({ id: "call_abcdef123456", status: "completed" }), "call_abcdef123456");
});

test("anything that does not look like a call id is ignored", () => {
  assert.equal(callIdFrom(null), null);
  assert.equal(callIdFrom("call_abcdef123456"), null);
  assert.equal(callIdFrom({ data: { id: "../../v1/goals" } }), null);
  assert.equal(callIdFrom({ id: "evt_abc123def456" }), null);
  assert.equal(callIdFrom([{ id: "call_abcdef123456" }]), null);
});

test("the event id prefers the header and validates both", () => {
  assert.equal(eventIdFrom("evt_fromheader1", { id: "evt_frombody123" }), "evt_fromheader1");
  assert.equal(eventIdFrom(null, { id: "evt_frombody123" }), "evt_frombody123");
  assert.equal(eventIdFrom("<script>", { id: "nope" }), null);
});
