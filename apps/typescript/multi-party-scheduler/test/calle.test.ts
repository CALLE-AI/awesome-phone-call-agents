/**
 * The base URL check. Every request carries the API key, so which host it goes to
 * is a trust decision. https on its own only says the wire is encrypted, not who
 * is on the other end of it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTrustedBaseUrl,
  CALLE_HOST,
  createSdkPort,
  DEFAULT_BASE_URL,
  isLoopbackHost,
} from "../src/calle.js";
import { ConfigError } from "../src/config.js";

function refusal(baseUrl: string, allowHosts: string[] = []): string {
  try {
    assertTrustedBaseUrl(baseUrl, allowHosts);
  } catch (error) {
    assert.ok(error instanceof ConfigError, `expected ConfigError, got ${String(error)}`);
    return error.message;
  }
  throw new Error(`${baseUrl} was accepted`);
}

test("CALL-E and this machine are trusted with the key, nothing else is", () => {
  assert.equal(assertTrustedBaseUrl(DEFAULT_BASE_URL), DEFAULT_BASE_URL);
  assert.equal(assertTrustedBaseUrl("https://api.heycall-e.com/v1"), "https://api.heycall-e.com/v1");
  assert.equal(assertTrustedBaseUrl("http://127.0.0.1:49152"), "http://127.0.0.1:49152");
  assert.equal(assertTrustedBaseUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(assertTrustedBaseUrl("http://[::1]:3000"), "http://[::1]:3000");
  // Accepted by the old check, which read the scheme and not the host.
  assert.match(refusal("https://api.staging.heycall-e.com"), /is not a trusted host/);
});

test("nothing is suffix matched, so a host that ends in a trusted name is refused", () => {
  for (const url of [
    "https://localhost.attacker.example",
    "https://api.heycall-e.com.attacker.example",
    "https://notapi.heycall-e.com",
    "http://127.0.0.1.attacker.example",
    "http://169.254.169.254",
    "https://169.254.169.254/latest/meta-data/iam",
  ]) {
    assert.match(refusal(url), /Refusing to send CALLE_API_KEY/, url);
  }
});

test("another host is opted in by flag or by environment, and only exactly", () => {
  const url = "https://calle.internal.example";
  assert.match(refusal(url), /is not a trusted host/);
  assert.equal(assertTrustedBaseUrl(url, ["calle.internal.example"]), url);
  assert.equal(assertTrustedBaseUrl(url, ["CALLE.Internal.Example"]), url, "case is ignored");
  assert.match(refusal(url, ["other.internal.example"]), /is not a trusted host/);
  // Opting a host in does not buy plain http off this machine.
  assert.match(refusal("http://calle.internal.example", ["calle.internal.example"]), /Only https/);
  // A wildcard is not a hostname, so it is a config error rather than a pattern.
  assert.throws(() => assertTrustedBaseUrl(url, ["*.internal.example"]), ConfigError);

  process.env.CALLE_ALLOWED_HOSTS = "one.example, calle.internal.example";
  try {
    assert.equal(assertTrustedBaseUrl(url), url);
    assert.match(refusal("https://two.example"), /is not a trusted host/);
  } finally {
    delete process.env.CALLE_ALLOWED_HOSTS;
  }
});

test("the refusal names both ways to set the host, both ways to opt in and says nothing was sent", () => {
  const message = refusal("https://evil.test");
  assert.match(message, /Refusing to send CALLE_API_KEY/);
  assert.match(message, /--base-url/);
  assert.match(message, /CALLE_BASE_URL/);
  assert.match(message, /CALLE_ALLOWED_HOSTS/);
  assert.match(message, /--allow-host/);
  assert.match(message, new RegExp(CALLE_HOST.replaceAll(".", "\\.")));
  assert.match(message, /Nothing was sent\./);
});

test("a non https scheme, a bare host and a file path are all refused", () => {
  refusal("http://10.0.0.5:8080");
  refusal("http://evil.test");
  refusal("ws://localhost:3000");
  refusal("file:///tmp/calle");
  assert.match(refusal("api.heycall-e.com"), /is not a URL/);
});

test("a port is live unless it is pointed at this machine", async () => {
  const local = await createSdkPort({ apiKey: "calle_test_key", baseUrl: "http://127.0.0.1:49152" });
  assert.equal(local.live, false, "the fake server is not a real phone line");
  const remote = await createSdkPort({ apiKey: "calle_test_key", baseUrl: DEFAULT_BASE_URL });
  assert.equal(remote.live, true);
  assert.equal(isLoopbackHost("LOCALHOST"), true);
  assert.equal(isLoopbackHost("localhost.attacker.example"), false);
});
