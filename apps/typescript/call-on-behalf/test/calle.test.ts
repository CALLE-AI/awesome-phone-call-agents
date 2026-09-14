import assert from "node:assert/strict";
import test from "node:test";
import { allowedHosts, assertTrustedBaseUrl, CalleCallError, createSdkPort, DEFAULT_BASE_URL } from "../src/calle.js";
import { ConfigError } from "../src/config.js";

function refusal(baseUrl: string, extra: string[] = []): string {
  try {
    assertTrustedBaseUrl(baseUrl, extra);
  } catch (error) {
    assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
    return error.message;
  }
  return "";
}

test("the CALL-E host over https is trusted, whatever case or port it is written in", () => {
  assert.equal(DEFAULT_BASE_URL, "https://api.heycall-e.com");
  assertTrustedBaseUrl(DEFAULT_BASE_URL);
  assertTrustedBaseUrl("https://API.HeyCall-E.com:443/v1");
});

test("https on its own is not trust, so any other host is refused", () => {
  assert.match(refusal("https://api.example.com/v1"), /is not a host this app trusts, so the API key was not sent/);
  // A suffix that only looks like a host we trust, plus the cloud metadata address.
  assert.match(refusal("https://localhost.attacker.example"), /not a host this app trusts/);
  assert.match(refusal("https://api.heycall-e.com.attacker.example"), /not a host this app trusts/);
  assert.match(refusal("http://169.254.169.254/latest/meta-data/"), /not a host this app trusts/);
});

test("plain http is trusted on loopback only, so the local fake still runs", () => {
  assertTrustedBaseUrl("http://127.0.0.1:8787");
  assertTrustedBaseUrl("http://localhost:8787");
  assertTrustedBaseUrl("http://[::1]:8787");
  assert.match(refusal("http://api.heycall-e.com"), /does not use https, so the API key was not sent/);
  assert.match(refusal("http://10.0.0.7:8787"), /not a host this app trusts/);
});

test("a host the operator names is allowed, exactly and never by suffix", () => {
  assertTrustedBaseUrl("https://calle.internal.example", ["calle.internal.example"]);
  assertTrustedBaseUrl("https://calle.internal.example", ["CALLE.Internal.Example"]);
  assert.match(refusal("https://other.internal.example", ["calle.internal.example"]), /not a host this app trusts/);
  assert.match(refusal("https://sub.calle.internal.example", ["calle.internal.example"]), /not a host this app trusts/);
  // Named or not, only loopback gets to skip https.
  assert.match(refusal("http://calle.internal.example", ["calle.internal.example"]), /does not use https/);
});

test("CALLE_ALLOWED_HOSTS names hosts the same way, comma separated", () => {
  const hosts = allowedHosts([], " A.example , b.example ");
  assert.equal(hosts.has("a.example"), true);
  assert.equal(hosts.has("b.example"), true);
  assert.equal(hosts.has("c.example"), false);
  // Naming nothing leaves the default set, it does not empty it.
  for (const host of [undefined, "", "  "]) {
    assert.equal(allowedHosts([], host).has("api.heycall-e.com"), true);
    assert.equal(allowedHosts([], host).has("localhost"), true);
    assert.equal(allowedHosts([], host).has("127.0.0.1"), true);
    assert.equal(allowedHosts([], host).has("::1"), true);
  }
});

test("the refusal names every way of setting the base URL", () => {
  const message = refusal("https://api.example.com");
  assert.match(message, /--base-url/);
  assert.match(message, /CALLE_BASE_URL/);
  assert.match(message, /CALLE_ALLOWED_HOSTS/);
  assert.match(message, /--allow-host/);
  assert.match(message, /localhost, 127\.0\.0\.1 or ::1/);
});

test("anything that is not a URL is refused before the key is sent", () => {
  assert.match(refusal("ftp://api.heycall-e.com"), /does not use https/);
  assert.match(refusal("api.example.com"), /is not a URL/);
  assert.match(refusal(""), /is not a URL/);
});

test("the port refuses to build for an untrusted base URL", async () => {
  await assert.rejects(
    () => createSdkPort({ apiKey: "calle_test_key", baseUrl: "https://api.example.com" }),
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
