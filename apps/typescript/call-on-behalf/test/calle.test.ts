import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedBaseUrl, CalleCallError, createSdkPort, DEFAULT_BASE_URL } from "../src/calle.js";
import { ConfigError } from "../src/config.js";

function refusal(baseUrl: string): string {
  try {
    assertTrustedBaseUrl(baseUrl);
  } catch (error) {
    assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
    return error.message;
  }
  return "";
}

test("https is trusted and the default base URL is https", () => {
  assert.equal(DEFAULT_BASE_URL.startsWith("https://"), true);
  assertTrustedBaseUrl(DEFAULT_BASE_URL);
  assertTrustedBaseUrl("https://api.example.com/v1");
});

test("plain http is trusted on loopback only, so the local fake still runs", () => {
  assertTrustedBaseUrl("http://127.0.0.1:8787");
  assertTrustedBaseUrl("http://localhost:8787");
  assertTrustedBaseUrl("http://[::1]:8787");
  assert.match(refusal("http://api.example.com"), /is not trusted, so the API key was not sent/);
  assert.match(refusal("http://10.0.0.7:8787"), /not trusted/);
});

test("the refusal names both ways of setting the base URL", () => {
  const message = refusal("http://api.example.com");
  assert.match(message, /--base-url/);
  assert.match(message, /CALLE_BASE_URL/);
  assert.match(message, /localhost, 127\.0\.0\.1 or ::1/);
});

test("anything that is not an http URL is refused before the key is sent", () => {
  assert.match(refusal("ftp://api.example.com"), /not trusted/);
  assert.match(refusal("api.example.com"), /is not a URL/);
  assert.match(refusal(""), /is not a URL/);
});

test("the port refuses to build for an untrusted base URL", async () => {
  await assert.rejects(
    () => createSdkPort({ apiKey: "calle_test_key", baseUrl: "http://api.example.com" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /the API key was not sent/);
      return true;
    },
  );
});

test("an error with no status leaves the call unknown, a refusal does not", () => {
  assert.equal(new CalleCallError("sdk_error", "socket hang up").ambiguous, true);
  assert.equal(new CalleCallError("service_unavailable", "down", 503).ambiguous, true);
  assert.equal(new CalleCallError("rate_limited", "slow down", 429).ambiguous, true);
  assert.equal(new CalleCallError("insufficient_balance", "no credit", 402).ambiguous, false);
  assert.equal(new CalleCallError("unauthorized", "bad key", 401).ambiguous, false);
});
