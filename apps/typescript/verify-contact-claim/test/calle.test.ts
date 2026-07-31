/**
 * Base URL trust and error classification.
 *
 * The API key rides on every request, so the host is checked before a client
 * exists. Error classification decides whether this app may say no call was
 * placed, which is why it is pinned here rather than inferred at the call site.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedBaseUrl, CalleApiError, createSdkPort, parseAllowedHosts } from "../src/calle.js";
import { ClaimError } from "../src/config.js";

function refuses(baseUrl: string, fragment: string): void {
  assert.throws(
    () => assertTrustedBaseUrl(baseUrl),
    (error: unknown) => {
      assert.ok(error instanceof ClaimError, `expected a ClaimError, got ${String(error)}`);
      assert.match(error.message, new RegExp(fragment, "i"));
      // The operator has to be told which knobs set this.
      assert.match(error.message, /--base-url/);
      assert.match(error.message, /CALLE_BASE_URL/);
      assert.match(error.message, /CALLE_API_KEY was not sent/);
      return true;
    },
  );
}

test("the CALL-E host and loopback are trusted, and loopback may be plain http", () => {
  assert.equal(assertTrustedBaseUrl("https://api.heycall-e.com").protocol, "https:");
  assert.equal(assertTrustedBaseUrl("https://API.HeyCall-E.com/v1").protocol, "https:");
  assert.equal(assertTrustedBaseUrl("http://localhost:8080").hostname, "localhost");
  assert.equal(assertTrustedBaseUrl("http://127.0.0.1:39121").hostname, "127.0.0.1");
  assert.equal(assertTrustedBaseUrl("http://[::1]:39121").hostname, "[::1]");
  assert.equal(assertTrustedBaseUrl("https://localhost:8443").hostname, "localhost");
});

test("an https host nobody named is refused, because https is not trust", () => {
  refuses("https://calle.internal:8443/v1", "not a trusted CALL-E host");
  refuses("https://api.heycall-e.com.attacker.example", "not a trusted CALL-E host");
  refuses("https://api-heycall-e.com", "not a trusted CALL-E host");
  refuses("https://169.254.169.254/latest/meta-data", "not a trusted CALL-E host");
  // Named on purpose, so it goes through. The comparison is the whole hostname.
  assert.equal(
    assertTrustedBaseUrl("https://calle.internal:8443/v1", ["Calle.Internal"]).hostname,
    "calle.internal",
  );
});

test("an allowed host is an exact hostname and a pattern is refused", () => {
  assert.deepEqual(
    [...parseAllowedHosts(["calle.internal, gw.example.com", undefined, "  "])],
    ["calle.internal", "gw.example.com"],
  );
  // An IPv6 literal is a hostname, so the brackets come off and it survives.
  assert.deepEqual([...parseAllowedHosts(["[fd00::1]"])], ["fd00::1"]);
  for (const pattern of ["*.example.com", ".example.com", "example.com/v1", "example.com:8443"]) {
    assert.throws(
      () => parseAllowedHosts([pattern]),
      (error: unknown) => {
        assert.ok(error instanceof ClaimError, `expected a ClaimError for ${pattern}`);
        assert.match(error.message, /exact hostnames/);
        return true;
      },
    );
  }
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
    (error: unknown) => error instanceof ClaimError,
  );
  // https and still refused: the host is what decides, not the scheme.
  await assert.rejects(
    () => createSdkPort({ apiKey: "calle_test_key", baseUrl: "https://api.example.com" }),
    (error: unknown) => error instanceof ClaimError,
  );
  const port = await createSdkPort({
    apiKey: "calle_test_key",
    baseUrl: "https://calle.internal",
    allowedHosts: ["calle.internal"],
  });
  assert.equal(typeof port.createCall, "function");
});

test("an error only counts as a refusal when the call cannot exist", () => {
  // A reply the server chose to send about a bad request. Nothing was placed.
  assert.equal(new CalleApiError("insufficient_balance", "no", 402).ambiguous, false);
  assert.equal(new CalleApiError("invalid_recipient", "no", 400).ambiguous, false);
  assert.equal(new CalleApiError("unauthorized", "no", 401).ambiguous, false);
  // No reply, a late reply, a key that already has a call, a throttle or a server
  // fault. Any of these can sit on top of a call that was accepted.
  assert.equal(new CalleApiError("sdk_error", "socket hang up").ambiguous, true);
  assert.equal(new CalleApiError("request_timeout", "timeout", 408).ambiguous, true);
  assert.equal(new CalleApiError("idempotency_conflict", "conflict", 409).ambiguous, true);
  assert.equal(new CalleApiError("rate_limited", "slow down", 429).ambiguous, true);
  assert.equal(new CalleApiError("service_unavailable", "down", 503).ambiguous, true);
});
