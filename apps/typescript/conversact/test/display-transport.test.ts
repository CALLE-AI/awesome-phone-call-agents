import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assertTrustedBaseUrl, createSdkPort, LOOPBACK_FAKE_API_KEY } from "../src/calle.js";
import { redactDisplay } from "../src/safety.js";

test("loopback accepts only the fixed dummy credential, before SDK import", async () => {
  for (const base of ["http://127.0.0.1:9000", "http://localhost:9000", "https://[::1]:9000"]) {
    assert.doesNotThrow(() => assertTrustedBaseUrl(base, LOOPBACK_FAKE_API_KEY));
    assert.throws(() => assertTrustedBaseUrl(base, "fictional-non-dummy-token"), /literal conversact-fake-key/);
    await assert.rejects(createSdkPort("fictional-non-dummy-token", base), /literal conversact-fake-key/);
  }
  assert.doesNotThrow(() => assertTrustedBaseUrl("https://api.heycall-e.com", "fictional-non-dummy-token"));
  assert.throws(() => assertTrustedBaseUrl("http://api.heycall-e.com", LOOPBACK_FAKE_API_KEY));
  assert.throws(() => assertTrustedBaseUrl("https://example.com", LOOPBACK_FAKE_API_KEY));
});

test("terminal text masks free-text phones and known or bearer credentials", () => {
  const token = "fictional-example-token";
  const outcome = { reason: `Provider said call +12025550123; token=${token}`, items: [{ product_id: "Callback (202) 555-0123" }] };
  const before = structuredClone(outcome);
  const displayed = redactDisplay(JSON.stringify(outcome), [token]);
  assert.doesNotMatch(displayed, /12025550123|202\) 555-0123|fictional-example-token/);
  assert.match(displayed, /phone masked/);
  assert.equal(redactDisplay("Bearer fictional-other-token"), "Bearer [credential redacted]");
  assert.deepEqual(outcome, before);
});

test("all CLI terminal writes use the display boundary", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.(?:stdout|stderr)\.write/);
  assert.match(source, /stream\.write\(redactDisplay\(text/);
  assert.match(source, /writeDisplay\(`Reason:/);
});
