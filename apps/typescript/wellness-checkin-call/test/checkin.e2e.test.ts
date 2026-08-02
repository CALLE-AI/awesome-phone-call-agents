import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedBaseUrl, ConfigErrorBaseUrl, createSdkPort } from "../src/calle.js";
import { previewCheckin, runCheckin } from "../src/checkin.js";
import { ConfigError, parseRequest } from "../src/config.js";
import { startFakeCalle } from "../fake/calle-server.js";

const PHONE = "+12025550142";
const REQUEST = { workflow_id: "test-run", phone: PHONE, recipient_or_caregiver_opted_in: true as const };

test("preview never contacts a network and masks the phone number", () => {
  const plan = previewCheckin(REQUEST);
  assert.equal(plan.masked_phone.includes("550142"), false);
  assert.match(plan.masked_phone, /\*/);
});

test("a completed call is classified and returned", async (t) => {
  const fake = await startFakeCalle([
    {
      phone: PHONE,
      structuredResult: {
        answered: true,
        condition_summary: "feeling good",
        meal_status: "good",
        concerns_reported: false,
      },
    },
  ]);
  t.after(() => fake.close());
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });
  const report = await runCheckin({ request: REQUEST, port, pollIntervalMs: 5 });

  assert.equal(report.level, "ok");
  assert.equal(fake.created.length, 1);
  assert.equal(report.masked_phone.includes("550142"), false);
});

test("the same workflow_id reuses the call instead of dialing twice", async (t) => {
  const fake = await startFakeCalle([{ phone: PHONE, structuredResult: { answered: true } }]);
  t.after(() => fake.close());
  const port = await createSdkPort({ apiKey: "calle_demo_key", baseUrl: fake.baseUrl });

  await runCheckin({ request: REQUEST, port, pollIntervalMs: 5 });
  await runCheckin({ request: REQUEST, port, pollIntervalMs: 5 });

  assert.equal(fake.created.length, 1);
});

test("a request missing recorded opt-in is rejected before any call is placed", () => {
  assert.throws(
    () =>
      parseRequest({
        workflow_id: "no-consent",
        phone: PHONE,
        recipient_or_caregiver_opted_in: false,
      }),
    ConfigError
  );
});

test("an untrusted base URL is refused before the API key would be sent", () => {
  assert.throws(() => assertTrustedBaseUrl("https://attacker.example"), ConfigErrorBaseUrl);
  assert.throws(() => assertTrustedBaseUrl("http://api.heycall-e.com"), ConfigErrorBaseUrl);
  assert.doesNotThrow(() => assertTrustedBaseUrl("https://api.heycall-e.com"));
  assert.doesNotThrow(() => assertTrustedBaseUrl("http://127.0.0.1:4000"));
});
