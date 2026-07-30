/**
 * Base URL trust and error classification.
 *
 * The API key rides on every request, so the host is checked before a client
 * exists. Error classification decides whether the gate may say a call was not
 * placed, which is why it is pinned here rather than inferred at the call site.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { GateApiError, assertTrustedBaseUrl, createSdkPort } from "../src/calle.js";
import { ConfigError } from "../src/config.js";

function refuses(baseUrl: string, fragment: string): void {
  assert.throws(
    () => assertTrustedBaseUrl(baseUrl),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
      assert.match(error.message, new RegExp(fragment, "i"));
      // The operator has to be told which knobs set this.
      assert.match(error.message, /--base-url/);
      assert.match(error.message, /CALLE_BASE_URL/);
      return true;
    },
  );
}

test("https is accepted and plain http is accepted on loopback only", () => {
  assert.equal(assertTrustedBaseUrl("https://api.heycall-e.com").protocol, "https:");
  assert.equal(assertTrustedBaseUrl("https://calle.internal:8443/v1").protocol, "https:");
  assert.equal(assertTrustedBaseUrl("http://localhost:8080").hostname, "localhost");
  assert.equal(assertTrustedBaseUrl("http://127.0.0.1:39121").hostname, "127.0.0.1");
  assert.equal(assertTrustedBaseUrl("http://[::1]:39121").hostname, "[::1]");
});

test("a plain http host that is not loopback is refused, not warned about", () => {
  refuses("http://api.heycall-e.com", "unencrypted");
  refuses("http://169.254.169.254/latest/meta-data", "unencrypted");
  refuses("http://localhost.attacker.example", "unencrypted");
});

test("a base URL that is not http or https is refused", () => {
  refuses("file:///etc/passwd", "does not use http or https");
  refuses("ftp://example.com", "does not use http or https");
  refuses("api.heycall-e.com", "is not a URL");
  refuses("", "is not a URL");
});

test("the adapter refuses before it builds a client that holds the key", async () => {
  await assert.rejects(
    () => createSdkPort({ apiKey: "calle_test_key", baseUrl: "http://api.example.com" }),
    (error: unknown) => error instanceof ConfigError,
  );
});

test("an error only counts as a refusal when the call cannot exist", () => {
  // A reply the server sent on purpose. Nothing was placed.
  assert.equal(new GateApiError("insufficient_balance", "no", 402).ambiguous, false);
  assert.equal(new GateApiError("invalid_recipient", "no", 400).ambiguous, false);
  assert.equal(new GateApiError("rate_limited", "no", 429).ambiguous, false);
  // No reply, a late reply or a key that already has a call. Any of these can
  // sit on top of a call that was accepted.
  assert.equal(new GateApiError("sdk_error", "socket hang up").ambiguous, true);
  assert.equal(new GateApiError("request_timeout", "timeout", 408).ambiguous, true);
  assert.equal(new GateApiError("idempotency_conflict", "conflict", 409).ambiguous, true);
  assert.equal(new GateApiError("service_unavailable", "down", 503).ambiguous, true);
});
