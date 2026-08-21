import assert from "node:assert/strict";
import test from "node:test";
import { buildPreview, maskPhone, validateRequest } from "../src/workflow.js";

const valid = {
  request_id: "rfq-1", project_name: "Project Elm", supplier_name: "Demo Supplier",
  phone: "+442079460123", region: "GB", locale: "en-GB",
  consent_note: "The contact consented to one automated call.", material: "48 timber lengths",
  requested_delivery_date: "2026-09-02", questions: ["Can you deliver the full quantity?"],
  calling_window: "Weekdays 09:00-16:00 local time",
};

test("builds a stable approval receipt", () => {
  const request = validateRequest(valid);
  assert.equal(buildPreview(request).receipt, buildPreview(request).receipt);
});

test("changing the call changes the approval receipt", () => {
  const a = buildPreview(validateRequest(valid)).receipt;
  const b = buildPreview(validateRequest({ ...valid, material: "49 timber lengths" })).receipt;
  assert.notEqual(a, b);
});

test("masks the destination", () => assert.equal(maskPhone("+442079460123"), "+44********23"));

test("refuses unsupported regions", () => {
  assert.throws(() => validateRequest({ ...valid, region: "DK" }), /not currently supported/);
});

test("refuses missing consent evidence", () => {
  assert.throws(() => validateRequest({ ...valid, consent_note: "Public company number" }), /permission or authorization/);
});

test("task prohibits commitments", () => {
  const task = buildPreview(validateRequest(valid)).task;
  assert.match(task, /Do not negotiate, place an order/);
  assert.match(task, /automated assistant/);
});
