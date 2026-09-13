import assert from "node:assert/strict";
import test from "node:test";

import * as cardUtils from "../card-utils.mjs";

const {
  PHONE_PROPERTY_OPTIONS,
  buildCardCallParameters,
  buildCardServerlessRequest,
  buildCallSummary,
  nextCardRequestId,
  readObjectContext,
  readServerlessBody,
  reduceCardIntentState,
} = cardUtils;

test("reads object body from HubSpot serverless result", () => {
  assert.deepEqual(readServerlessBody({ body: { status: "candidate" } }), { status: "candidate" });
});

test("reads JSON string body from HubSpot serverless result", () => {
  assert.deepEqual(readServerlessBody({ body: "{\"status\":\"running\"}" }), { status: "running" });
});

test("uses direct result as body when no body wrapper exists", () => {
  assert.deepEqual(readServerlessBody({ status: "cancelled" }), { status: "cancelled" });
});

test("returns empty object for invalid JSON string bodies", () => {
  assert.deepEqual(readServerlessBody({ body: "not json" }), {});
});

test("reads HubSpot CRM object context for app card calls", () => {
  assert.deepEqual(
    readObjectContext({
      crm: {
        objectId: "67890",
        objectTypeId: "0-1",
      },
      portal: {
        id: 12345,
      },
    }),
    {
      objectId: "67890",
      objectType: "contact",
      portalId: "12345",
    }
  );
});

test("maps only the portable HubSpot Contact object type ID", () => {
  assert.equal(readObjectContext({ crm: { objectTypeId: "0-1" } }).objectType, "contact");
  assert.equal(readObjectContext({ crm: { objectTypeId: "0-3" } }).objectType, "");
  assert.equal(readObjectContext({ crm: { objectTypeId: "0-5" } }).objectType, "");
  assert.equal(readObjectContext({ crm: {} }).objectType, "");
});

test("rejects an unsupported CRM object context before building call parameters", () => {
  assert.throws(
    () => buildCardCallParameters({
      objectContext: {
        objectId: "67890",
        objectType: "",
      },
      callTask: "Qualify demo interest.",
      phoneProperty: "phone",
      requestId: "intent-1",
    }),
    /Contact context/
  );
});

test("rejects Deal card parameters because Deals have no portable default phone property", () => {
  assert.throws(
    () => buildCardCallParameters({
      objectContext: {
        objectId: "67890",
        objectType: "deal",
      },
      callTask: "Qualify demo interest.",
      phoneProperty: "phone",
      requestId: "intent-1",
    }),
    /Contact context/
  );
});

test("builds serverless parameters for starting a CALL-E call from a card", () => {
  assert.deepEqual(
    buildCardCallParameters({
      objectContext: {
        objectId: "67890",
        objectType: "contact",
        portalId: "12345",
      },
      callTask: "Qualify demo interest.",
      phoneProperty: "mobilephone",
      requestId: "intent-1",
    }),
    {
      source_object_id: "67890",
      source_object_type: "contact",
      call_task: "Qualify demo interest.",
      phone_property: "mobilephone",
      request_id: "intent-1",
      confirmed: true,
    }
  );
});

test("builds the HubSpot private serverless invocation contract", () => {
  assert.equal(typeof buildCardServerlessRequest, "function");
  assert.deepEqual(
    buildCardServerlessRequest({
      objectContext: {
        objectId: "67890",
        objectType: "contact",
        portalId: "12345",
      },
      callTask: "Qualify demo interest.",
      phoneProperty: "mobilephone",
      requestId: "intent-1",
    }),
    {
      parameters: {
        source_object_id: "67890",
        source_object_type: "contact",
        call_task: "Qualify demo interest.",
        phone_property: "mobilephone",
        request_id: "intent-1",
        confirmed: true,
      },
      propertiesToSend: ["phone", "mobilephone"],
    }
  );
});

test("limits card phone selection to supported HubSpot properties", () => {
  assert.deepEqual(PHONE_PROPERTY_OPTIONS, [
    { label: "Phone", value: "phone" },
    { label: "Mobile phone", value: "mobilephone" },
  ]);
});

test("keeps a request ID for an ambiguous retry and rotates for a new intent", () => {
  assert.equal(typeof nextCardRequestId, "function");
  const generated = ["intent-1", "intent-2"];
  const createRequestId = () => generated.shift();

  const firstIntent = nextCardRequestId("", "begin", createRequestId);
  const ambiguousRetry = nextCardRequestId(firstIntent, "ambiguous_error", createRequestId);
  const completed = nextCardRequestId(ambiguousRetry, "terminal", createRequestId);
  const secondIntent = nextCardRequestId(completed, "begin", createRequestId);
  const cancelled = nextCardRequestId(secondIntent, "cancel", createRequestId);

  assert.equal(firstIntent, "intent-1");
  assert.equal(ambiguousRetry, "intent-1");
  assert.equal(completed, "");
  assert.equal(secondIntent, "intent-2");
  assert.equal(cancelled, "");
});

test("reduces Card intent state for every terminal and retry outcome", () => {
  assert.equal(typeof reduceCardIntentState, "function");
  const active = { requestId: "intent-1", confirming: true };

  assert.deepEqual(
    reduceCardIntentState(active, {
      type: "result",
      result: { success: true, retry_same_intent: false },
    }),
    { requestId: "", confirming: false }
  );
  assert.deepEqual(
    reduceCardIntentState(active, {
      type: "result",
      result: { success: false, retry_same_intent: false },
    }),
    { requestId: "", confirming: false }
  );
  assert.deepEqual(
    reduceCardIntentState(active, {
      type: "result",
      result: { success: false, retry_same_intent: true },
    }),
    active
  );
  assert.deepEqual(reduceCardIntentState(active, { type: "transport_error" }), active);
  assert.deepEqual(
    reduceCardIntentState(active, { type: "cancel" }),
    { requestId: "", confirming: false }
  );
});

test("formats safe card call summaries", () => {
  assert.equal(
    buildCallSummary({
      call_id: "call_123",
      status: "queued",
      masked_phone: "[phone]",
      error: "",
    }),
    "CALL-E call call_123 is queued for [phone]."
  );
  assert.equal(
    buildCallSummary({
      call_id: "",
      status: "invalid_phone",
      masked_phone: "[phone]",
      error: "Phone number must use E.164 format.",
    }),
    "invalid_phone: Phone number must use E.164 format."
  );
});
