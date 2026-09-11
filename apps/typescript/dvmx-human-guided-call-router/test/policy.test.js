import test from "node:test";
import assert from "node:assert/strict";
import { classifyCallRequest, classifyFollowup, validateE164, maskPhone } from "../src/policy.js";

test("accepts valid E.164", () => {
  assert.equal(validateE164("+15555550100"), true);
});

test("rejects invalid phone format", () => {
  assert.equal(classifyCallRequest({phone:"555-0100",consent:true}).decision, "DENY");
});

test("requires human when consent is not confirmed", () => {
  assert.equal(classifyCallRequest({phone:"+15555550100",consent:false}).decision, "REQUIRE_HUMAN");
});

test("denies secret collection", () => {
  assert.equal(classifyCallRequest({
    phone:"+15555550100",consent:true,purpose:"Ask for API key"
  }).decision, "DENY");
});

test("requires human for sensitive domains", () => {
  assert.equal(classifyCallRequest({
    phone:"+15555550100",consent:true,domain:"financial"
  }).decision, "REQUIRE_HUMAN");
});

test("requires human for consequential followup", () => {
  assert.equal(classifyFollowup({requested_action:"payment"}).decision, "REQUIRE_HUMAN");
});

test("masks phone numbers", () => {
  assert.equal(maskPhone("+15555550100"), "***0100");
});
