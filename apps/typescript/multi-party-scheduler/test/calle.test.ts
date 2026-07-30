/**
 * The base URL check. Every request carries the API key, so an arbitrary base URL
 * is a way to post the credential somewhere else.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedBaseUrl, DEFAULT_BASE_URL } from "../src/calle.js";
import { ConfigError } from "../src/config.js";

function refusal(baseUrl: string): string {
  try {
    assertTrustedBaseUrl(baseUrl);
  } catch (error) {
    assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
    return error.message;
  }
  throw new Error(`${baseUrl} was accepted`);
}

test("https is trusted, including the default", () => {
  assert.equal(assertTrustedBaseUrl(DEFAULT_BASE_URL), DEFAULT_BASE_URL);
  assert.equal(assertTrustedBaseUrl("https://api.staging.heycall-e.com"), "https://api.staging.heycall-e.com");
});

test("plain http is trusted only on loopback, which is what the fake server uses", () => {
  assert.equal(assertTrustedBaseUrl("http://127.0.0.1:49152"), "http://127.0.0.1:49152");
  assert.equal(assertTrustedBaseUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(assertTrustedBaseUrl("http://[::1]:3000"), "http://[::1]:3000");
});

test("an untrusted base URL is refused and the message names both ways to set it", () => {
  const message = refusal("http://api.internal.example.com");
  assert.match(message, /Refusing to send CALLE_API_KEY/);
  assert.match(message, /--base-url/);
  assert.match(message, /CALLE_BASE_URL/);
  assert.match(message, /Nothing was sent\./);
});

test("a non-https scheme, a bare host and a file path are all refused", () => {
  refusal("http://10.0.0.5:8080");
  refusal("http://evil.test");
  refusal("ws://localhost:3000");
  refusal("file:///tmp/calle");
  assert.match(refusal("api.heycall-e.com"), /is not a URL/);
});
