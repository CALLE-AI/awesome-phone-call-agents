import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PhoneAdapter } from "../provider.ts";
import { Engine } from "../engine.ts";
import { Store } from "../store.ts";
const recordedId = "99e49ac4-bede-471c-8017-7189fd89d2ed";
test("captured route rejection replays with no provider access or quota use", async () => {
  let requests = 0;
  const client = {
    calls: {
      create: async () => {
        requests++;
        throw Error("Unexpected network");
      },
      get: async () => {
        requests++;
        throw Error("Unexpected network");
      },
    },
  };
  const store = new Store(
    join(mkdtempSync(join(tmpdir(), "lastcrate-replay-")), "db.sqlite"),
  );
  const engine = new Engine(store, client, 0);
  const run = engine.create(
    { mode: "fixture", replayId: recordedId },
    "replay-rejection-test",
  );
  for (let i = 0; i < 50 && engine.busy.has(run.id); i++)
    await new Promise((r) => setTimeout(r, 5));
  const end = store.get(run.id);
  assert.equal(end.state, "review");
  assert.equal(end.providerError.code, "call_not_ready");
  assert.equal(end.provenance, "live-recording-replay");
  assert.equal(requests, 0);
  assert.equal(store.used(), 0);
});
test("recorded fixtures reject tampered inputs or response values", () => {
  const dir = mkdtempSync(join(tmpdir(), "lastcrate-integrity-"));
  const adapter = new PhoneAdapter(null, dir);
  const bundle = adapter.read(recordedId);
  bundle.input.quantity = 999;
  writeFileSync(adapter.path(recordedId), JSON.stringify(bundle));
  assert.throws(() => adapter.read(recordedId), /integrity/);
});
test("test-double transports never create files labeled as live recordings", () => {
  const dir = mkdtempSync(join(tmpdir(), "lastcrate-provenance-"));
  const adapter = new PhoneAdapter({ calls: {} }, dir);
  adapter.record({
    id: "fake-test",
    input: { mode: "live" },
    calls: [],
    providerError: { code: "test", message: "Synthetic" },
  });
  assert.equal(
    adapter.list().some((r) => r.id === "fake-test"),
    false,
  );
});
test("recorded rejection contains no private destination or credentials", () => {
  const text = readFileSync(
    new URL(
      "../response-fixtures/recorded-route-rejection.json",
      import.meta.url,
    ),
    "utf8",
  );
  const bundle = JSON.parse(text);
  assert.equal(bundle.provenance, "live-recording");
  assert.equal(bundle.calls.length, 0);
  assert.equal(bundle.error.code, "call_not_ready");
  assert.equal(/iams_live_/.test(text), false);
  assert.ok(
    (text.match(/\+\d{8,15}/g) || []).every((n) => n.startsWith("+120255501")),
  );
});
