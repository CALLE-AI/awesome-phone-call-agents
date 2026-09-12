import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../engine.ts";
import { Store } from "../store.ts";
import { buildRequest, rankPartners } from "../workflow.ts";
import { fixtureCall } from "../fixtures.ts";
const input: any = {
  donor: "Fixture Bakery",
  address: "18 Test Road",
  phone: "+12025550101",
  date: "2099-09-12",
  offset: "+05:30",
  ready: "17:30",
  cutoff: "23:59",
  quantity: 48,
  region: "US",
  mode: "live",
  scenario: "happy",
  partners: [
    {
      name: "Fixture Collector",
      phone: "+12025550102",
      capacity: 60,
      travelMinutes: 1,
      approved: true,
    },
  ],
};
function setup(callId: string | null) {
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "lastcrate-recovery-")), "db.sqlite"),
  );
  const request = {
    ...buildRequest(input, "donor"),
    metadata: { run_id: "recovery" },
  };
  store.save({
    id: "recovery",
    clientKey: "original-key",
    input,
    roleplay: true,
    state: "paused",
    stopped: false,
    offer: null,
    selected: null,
    ranking: [],
    events: [],
    ticket: null,
    calls: [
      {
        role: "donor",
        id: callId,
        status: "queued",
        key: "original-provider-key",
        request,
        result: null,
      },
    ],
  });
  return { store, request };
}
test("saved ID recovery reads the original call and never creates another donor call", async () => {
  const { store } = setup("call_saved");
  let creates = 0,
    gets = 0;
  const donor = fixtureCall("donor", input, null, null);
  const client = {
    calls: {
      get: async (id: string) => {
        gets++;
        assert.equal(id, "call_saved");
        return donor;
      },
      create: async () => {
        creates++;
        const offer = donor.structuredResult;
        return fixtureCall("partner", input, offer, {
          earliest: Math.max(
            1050,
            new Date().getUTCHours() * 60 +
              new Date().getUTCMinutes() +
              330 +
              4,
          ),
        });
      },
    },
  };
  const engine = new Engine(store, client, 0);
  await engine.advance("recovery");
  assert.equal(gets, 1);
  assert.equal(creates, 1);
  assert.equal(
    store.get("recovery").calls.filter((c: any) => c.role === "donor").length,
    1,
  );
});
test("lost create response replays the exact saved request and idempotency key", async () => {
  const { store, request } = setup(null);
  let first = true;
  const client = {
    calls: {
      create: async (body: any, options: any) => {
        if (first) {
          first = false;
          assert.deepEqual(body, request);
          assert.equal(options.idempotencyKey, "original-provider-key");
          return fixtureCall(
            "donor",
            { ...input, scenario: "unclear" },
            null,
            null,
          );
        }
        throw Error("Unexpected second call");
      },
    },
  };
  await new Engine(store, client, 0).advance("recovery");
  assert.equal(store.get("recovery").state, "review");
  assert.equal(store.used(), 1);
});
test("stopping a paused partner call still reconciles its existing ID", async () => {
  const { store } = setup("call_donor");
  const run = store.get("recovery");
  const offer = fixtureCall("donor", input, null, null).structuredResult;
  run.offer = offer;
  run.selected = rankPartners(input, offer, 1000)[0];
  run.calls[0].result = fixtureCall("donor", input, null, null);
  run.calls.push({
    role: "partner",
    id: "call_partner_saved",
    status: "in_progress",
    key: "partner-key",
    request: buildRequest(input, "partner", offer, run.selected),
    result: null,
  });
  store.save(run);
  let reads = 0;
  const client = {
    calls: {
      get: async (id: string) => {
        assert.equal(id, "call_partner_saved");
        reads++;
        return fixtureCall("partner", input, offer, run.selected);
      },
      create: async () => {
        throw Error("A recovery must not redial");
      },
    },
  };
  const engine = new Engine(store, client, 0);
  engine.stop("recovery");
  await engine.advance("recovery");
  assert.equal(reads, 1);
  assert.equal(store.get("recovery").state, "agreed");
  assert.equal(store.get("recovery").stopped, true);
});
