import assert from "node:assert/strict";
import test from "node:test";
import { CallService, FakeCalle, httpProvider, maskText } from "../src/calls.js";

const phone = "+12025550123";

test("result projections mask phones without changing the private request or provider fixture", async () => {
  const outcome = { summary: `Contact ${phone}`, structured: { detail: `Contact ${phone}` }, transcript: [{ speaker: "user" as const, text: `Contact ${phone}` }] };
  const fake = new FakeCalle(outcome);
  const service = new CallService({ provider: fake });
  const placed = await service.placeCall("operator", { phone, goal: "Ask about opening hours." });
  assert(placed.ok);
  fake.complete(fake.created[0]!.id);
  const result = await service.refreshStatus("operator", placed.actionId);
  assert(!JSON.stringify(result).includes(phone));
  assert.equal(fake.created[0]!.body.recipients[0]!.phones[0], phone);
  assert(outcome.summary.includes(phone));
  assert(!maskText(`Call ${phone}`).includes(phone));
});

test("authenticated requests reject redirects and preserve ambiguous outcome", async () => {
  const previous = globalThis.fetch;
  const redirects: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    redirects.push(init?.redirect);
    throw new Error("Synthetic redirect refused; no network");
  };
  try {
    const provider = httpProvider("test-only-key");
    const result = await provider.createCall({ task: "Synthetic enquiry", recipients: [{ phones: [phone], region: "US", locale: "en-US" }], result_schema: {}, metadata: { action_id: "fake" } }, "fake-intent");
    assert.deepEqual(result, { ok: false, code: "provider_unreachable", keepCharge: true });
    assert.deepEqual(await provider.getCall("fake-call"), { ok: false });
    assert.deepEqual(redirects, ["error", "error"]);
  } finally {
    globalThis.fetch = previous;
  }
});
