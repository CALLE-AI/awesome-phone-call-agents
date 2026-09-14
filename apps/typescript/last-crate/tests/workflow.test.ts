import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateInput,
  verifyDonor,
  verifyPartner,
  rankPartners,
  buildRequest,
} from "../workflow.ts";
import { fixtureCall } from "../fixtures.ts";
import { Store } from "../store.ts";
import { Engine } from "../engine.ts";
const input: any = {
  donor: "Fixture Bakery",
  address: "18 Test Road",
  phone: "+12025550101",
  date: "2026-09-12",
  offset: "+05:30",
  ready: "17:30",
  cutoff: "18:30",
  quantity: 48,
  region: "US",
  mode: "fixture",
  scenario: "happy",
  partners: [
    {
      name: "Small Kitchen",
      phone: "+12025550102",
      capacity: 30,
      travelMinutes: 8,
      approved: true,
    },
    {
      name: "Neighbour Table",
      phone: "+12025550103",
      capacity: 60,
      travelMinutes: 12,
      approved: true,
    },
  ],
};
const donor = () => fixtureCall("donor", input, null, null);
const store = () =>
  new Store(join(mkdtempSync(join(tmpdir(), "lastcrate-")), "test.sqlite"));
async function finish(engine: Engine, id: string) {
  for (let i = 0; i < 200; i++) {
    const r = engine.store.get(id);
    if (!["calling_donor", "matching", "calling_partner"].includes(r.state))
      return r;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Test workflow did not finish");
}
test("capacity beats proximity and the ticket uses the confirmed quantity", async () => {
  const s = store(),
    e = new Engine(s, null, 1);
  const r = e.create(input, "offline-happy");
  const end = await finish(e, r.id);
  assert.equal(end.state, "agreed");
  assert.equal(end.selected.name, "Neighbour Table");
  assert.equal(end.ticket.quantity, 48);
  assert.equal(end.calls.length, 2);
  assert.equal(s.used(), 0);
});
test("declined, unclear, late and unanswered calls never produce tickets", async () => {
  for (const scenario of ["declined", "unclear", "window", "no-answer"]) {
    const e = new Engine(store(), null, 1);
    const r = e.create({ ...input, scenario }, "scenario-" + scenario);
    const end = await finish(e, r.id);
    assert.equal(end.ticket, null);
    assert.ok(["review", "declined"].includes(end.state));
    assert.equal(
      end.calls.length,
      ["unclear", "no-answer"].includes(scenario) ? 1 : 2,
    );
  }
});
test("completed status and high confidence cannot substitute for evidence", () => {
  const c = donor();
  c.structuredResult.evidence = "This was never said by the human.";
  assert.equal(verifyDonor(c).ok, false);
  c.structuredResult = null;
  assert.equal(verifyDonor(c).ok, false);
});
test("bot-only confirmations cannot authorize a ticket", () => {
  const c = donor();
  c.recipients[0].attempts[0].transcriptTurns[1].speaker = "bot";
  assert.equal(verifyDonor(c).ok, false);
});
test("partial quantity, unknown transport, and out-of-window arrival are rejected", () => {
  const offer = donor().structuredResult;
  const p = rankPartners(input, offer, 1040)[0];
  for (const patch of [
    { quantity: 47 },
    { ownTransport: "unknown" },
    { arrival: "18:45" },
    { arrival: "17:00" },
  ]) {
    const c = fixtureCall("partner", input, offer, p);
    Object.assign(c.structuredResult, patch);
    assert.equal(verifyPartner(c, offer, p.earliest).ok, false);
  }
});
test("no feasible collector creates no second call", async () => {
  const e = new Engine(store(), null, 1);
  const r = e.create({ ...input, quantity: 100 }, "too-much-bread");
  const end = await finish(e, r.id);
  assert.equal(end.state, "review");
  assert.equal(end.calls.length, 1);
});
test("request idempotency returns the same run", async () => {
  const e = new Engine(store(), null, 1);
  const a = e.create(input, "same-request-key"),
    b = e.create(input, "same-request-key");
  assert.equal(a.id, b.id);
  await finish(e, a.id);
  assert.equal(e.store.all().length, 1);
});
test("invalid dates, times and capacity are rejected before creation", () => {
  for (const patch of [
    { ready: "19:00" },
    { quantity: 0 },
    { cutoff: "24:00" },
    { partners: [] },
    { offset: "garbage" },
    { mode: "live", phone: "0740000000" },
  ])
    assert.throws(() => validateInput({ ...input, ...patch }));
});
test("call budget persists and same reservation is free", () => {
  const s = store();
  s.reserve("one", 1);
  s.reserve("one", 1);
  assert.equal(s.used(), 1);
  assert.throws(() => s.reserve("two", 1));
});
test("partner call carries the verified offer and explicit bounded authority", () => {
  const offer = donor().structuredResult;
  const p = rankPartners(input, offer, 1040)[0];
  const r = buildRequest(input, "partner", offer, p);
  assert.match(r.task, /exactly 48/);
  assert.match(r.task, /No substitutes or partial pickups/);
  assert.equal(r.recipients[0].phones[0], p.phone);
});
test("stop during donor call prevents the partner call", async () => {
  const e = new Engine(store(), null, 10);
  const r = e.create(input, "stop-request");
  e.stop(r.id);
  const end = await finish(e, r.id);
  assert.equal(end.state, "stopped");
  assert.equal(end.calls.length, 1);
  assert.equal(end.ticket, null);
});
