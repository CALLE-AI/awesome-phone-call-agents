// Tests for the safety boundary helpers. No network, no calls.

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_BASE_URL, resolveBaseUrl, maskPhone, assertLiveInputAuthorized } from "./safety.js";

test("resolveBaseUrl defaults to the official API when unset/blank", () => {
  assert.equal(resolveBaseUrl(), DEFAULT_BASE_URL);
  assert.equal(resolveBaseUrl(""), DEFAULT_BASE_URL);
  assert.equal(resolveBaseUrl("   "), DEFAULT_BASE_URL);
});

test("resolveBaseUrl allows official HTTPS heycall-e.com hosts", () => {
  assert.equal(resolveBaseUrl("https://api.heycall-e.com"), "https://api.heycall-e.com");
  assert.equal(resolveBaseUrl("https://staging.heycall-e.com"), "https://staging.heycall-e.com");
  assert.equal(resolveBaseUrl("https://heycall-e.com"), "https://heycall-e.com");
});

test("resolveBaseUrl allows loopback for local testing", () => {
  assert.equal(resolveBaseUrl("http://localhost:8080"), "http://localhost:8080");
  assert.equal(resolveBaseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("resolveBaseUrl fails closed on a foreign or downgraded origin", () => {
  assert.throws(() => resolveBaseUrl("https://evil.example.com"), /non-allowlisted/);
  assert.throws(() => resolveBaseUrl("http://api.heycall-e.com"), /non-allowlisted/); // no HTTPS
  assert.throws(() => resolveBaseUrl("https://api.heycall-e.com.evil.com"), /non-allowlisted/);
  assert.throws(() => resolveBaseUrl("not a url"), /not a valid URL/);
});

test("maskPhone reveals only the last two digits", () => {
  assert.equal(maskPhone("+12025550143"), "+*********43");
  assert.equal(maskPhone("2025550143"), "********43");
  assert.equal(maskPhone(""), "");
});

test("assertLiveInputAuthorized fails closed on --live without --smoke", () => {
  assert.throws(() => assertLiveInputAuthorized({ live: true, smoke: false }), /will not dial the checked-in/);
});

test("assertLiveInputAuthorized allows live+smoke and any dry-run", () => {
  assert.doesNotThrow(() => assertLiveInputAuthorized({ live: true, smoke: true }));
  assert.doesNotThrow(() => assertLiveInputAuthorized({ live: false, smoke: false }));
  assert.doesNotThrow(() => assertLiveInputAuthorized({ live: false, smoke: true }));
});
