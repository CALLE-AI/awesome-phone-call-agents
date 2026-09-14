import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { CalleClient } from "../src/calle.ts";
import { FAKE_KEY, FakeCalle, type Outcome } from "../src/fake-calle.ts";
import { Ledger, taskId } from "../src/ledger.ts";
import { approveVendor, board, planRace, requestHold, startRace, syncRace } from "../src/race.ts";
import type { QuoteRequest } from "../src/task.ts";
import { handleWebhook } from "../src/webhook.ts";

const examples = path.resolve(import.meta.dirname, "..", "examples");
const request = JSON.parse(fs.readFileSync(path.join(examples, "request.json"), "utf8")) as QuoteRequest;
const outcomes = JSON.parse(fs.readFileSync(path.join(examples, "fake-outcomes.json"), "utf8")) as Record<string, Outcome>;
const allowlist = new Set(request.vendors.map((v) => v.phone));
const opts = { webhookUrl: null, allowlist };

let fake: FakeCalle;
let client: CalleClient;
let ledger: Ledger;
const advanceAll = async (times = 3) => {
  for (let i = 0; i < times; i += 1) {
    for (const call of fake.calls.values()) fake.advance(call);
    await syncRace(ledger, client);
  }
};

before(async () => {
  fake = new FakeCalle(outcomes);
  client = new CalleClient(FAKE_KEY, await fake.start());
});
after(() => fake.stop());
beforeEach(() => {
  fake.reset();
  ledger = new Ledger(null);
});

describe("quote race", () => {
  it("previews without a key, masking every number", () => {
    const plan = planRace(request, { webhookUrl: null });
    assert.equal(plan.calls.length, 3);
    assert.ok(plan.recipients.every((r) => !r.phone.includes("5550")));
    assert.throws(() => planRace({ ...request, vendors: request.vendors.slice(0, 1) }, { webhookUrl: null }), /at least two/);
  });
  it("refuses to dial numbers outside the allowlist", async () => {
    await assert.rejects(startRace(ledger, client, request, { webhookUrl: null, allowlist: new Set() }), /ALLOWLIST/);
    assert.equal(fake.requests.length, 0);
  });
  it("never places a second call for the same vendor", async () => {
    await startRace(ledger, client, request, opts);
    await startRace(ledger, client, request, opts);
    assert.equal(fake.calls.size, 3);
    assert.equal(new Set(fake.requests.map((r) => r.idempotencyKey)).size, 3);
  });
  it("tracks queued -> ringing -> on the call -> completed and ranks the results", async () => {
    await startRace(ledger, client, request, opts);
    assert.deepEqual(board(ledger).tasks.map((t) => t.status), ["queued", "queued", "queued"]);
    await advanceAll(1);
    assert.ok(board(ledger).tasks.every((t) => t.status === "ringing"));
    await advanceAll(1);
    assert.ok(board(ledger).tasks.every((t) => t.status === "in_progress"));
    await advanceAll(1);
    const b = board(ledger);
    assert.ok(b.tasks.every((t) => t.status === "completed"));
    assert.deepEqual(b.rankings, { cheapest: "riverside-produce", earliest: "northstar-foods" });
    assert.equal(b.quotes.find((q) => q.vendorId === "golden-gate-supply")?.status, "needs_review");
    assert.ok(ledger.data.tasks[taskId("quote", "riverside-produce")]!.transcript.length > 3);
  });
  it("records an unanswered call as failed with the raw reason", async () => {
    const quiet = new FakeCalle({});
    const quietClient = new CalleClient(FAKE_KEY, await quiet.start());
    try {
      await startRace(ledger, quietClient, request, opts);
      for (let i = 0; i < 3; i += 1) {
        for (const call of quiet.calls.values()) quiet.advance(call);
        await syncRace(ledger, quietClient);
      }
      assert.ok(board(ledger).tasks.every((t) => t.status === "failed" && t.lastError?.startsWith("no_answer")));
      assert.equal(board(ledger).quotes.length, 0);
    } finally {
      await quiet.stop();
    }
  });
  it("gates approval and the hold call behind explicit human decisions", async () => {
    await startRace(ledger, client, request, opts);
    await advanceAll();
    assert.throws(() => approveVendor(ledger, "riverside-produce", { humanApproved: false }), /approval/);
    assert.throws(() => approveVendor(ledger, "unknown-vendor", { humanApproved: true }), /validated quote/);
    await assert.rejects(requestHold(ledger, client, { ...opts, humanApproved: true }), /Approve a vendor/);
    approveVendor(ledger, "riverside-produce", { humanApproved: true });
    await assert.rejects(requestHold(ledger, client, { ...opts, humanApproved: false }), /approval/);
    const created = fake.requests.length;
    await requestHold(ledger, client, { ...opts, humanApproved: true });
    await requestHold(ledger, client, { ...opts, humanApproved: true });
    assert.equal(fake.requests.length, created + 1);
    const hold = fake.callFor("riverside-produce", "hold_request");
    assert.equal(hold.metadata.human_approved, "true");
    for (let i = 0; i < 3; i += 1) fake.advance(hold);
    await syncRace(ledger, client);
    assert.equal(board(ledger).hold?.result?.hold_placed, "yes");
  });
});

describe("unsigned webhook receiver", () => {
  const deliver = (headers: Record<string, string>, body: string) => handleWebhook(headers, body, { ledger, client });

  it("rejects a mismatched event id and ignores non-terminal events", async () => {
    await startRace(ledger, client, request, opts);
    const call = fake.callFor("riverside-produce", "supplier_quote");
    const { body } = fake.webhookFor(call);
    assert.equal((await deliver({ "calle-event-id": "evt_other" }, body)).status, 400);
    const progress = JSON.stringify({ id: "evt_p", type: "call.in_progress", data: call });
    assert.deepEqual((await deliver({ "calle-event-id": "evt_p" }, progress)).body, { ok: true, ignored: "call.in_progress" });
  });
  it("re-fetches the call instead of trusting the payload, and processes an event once", async () => {
    await startRace(ledger, client, request, opts);
    const call = fake.callFor("northstar-foods", "supplier_quote");
    for (let i = 0; i < 3; i += 1) fake.advance(call);
    const { headers, body } = fake.webhookFor(call);
    const tampered = JSON.parse(body);
    tampered.data.recipients[0].structured_result.unit_price = "0.01";
    const first = await deliver(headers, JSON.stringify(tampered));
    assert.deepEqual(first.body, { ok: true, status: "completed" });
    assert.equal(ledger.data.tasks[taskId("quote", "northstar-foods")]!.result?.unit_price, "13.75");
    assert.deepEqual((await deliver(headers, body)).body, { ok: true, duplicate: true });
  });
  it("answers 404 for calls it did not place and 409 while CALL-E is still finalizing", async () => {
    await startRace(ledger, client, request, opts);
    const foreign = JSON.stringify({ id: "evt_f", type: "call.completed", data: { id: "call_not_ours" } });
    assert.equal((await deliver({ "calle-event-id": "evt_f" }, foreign)).status, 404);
    const call = fake.callFor("golden-gate-supply", "supplier_quote");
    const early = JSON.stringify({ id: "evt_e", type: "call.completed", data: { id: call.id } });
    assert.equal((await deliver({ "calle-event-id": "evt_e" }, early)).status, 409);
    assert.equal(ledger.data.events.evt_e, undefined, "a failed claim is released so CALL-E's retry can succeed");
  });
});
