import assert from "node:assert/strict";
import test from "node:test";

import { deriveIdempotencyKey, type Authorization } from "asheard/ledger";

import { RedisIntents, haltReason, validIntentKey, type Exec } from "../src/lib/intents.ts";

/**
 * A Redis that lives in a Map, with the two commands the store uses.
 *
 * `SET ... NX` is the interesting one: it has to fail on an occupied key, or
 * the reservation race the store depends on is not being tested at all.
 */
function fakeRedis(): { exec: Exec; calls: unknown[][][]; store: Map<string, string> } {
  const store = new Map<string, string>();
  const calls: unknown[][][] = [];

  const exec: Exec = async (commands) => {
    calls.push(commands);
    return commands.map((command) => {
      const [verb, key, value, ...rest] = command as string[];
      if (verb === "SET") {
        if (rest.includes("NX") && store.has(key!)) return null;
        store.set(key!, value!);
        return "OK";
      }
      if (verb === "GET") return store.get(key!) ?? null;
      throw new Error(`The fake does not know ${verb}.`);
    });
  };

  return { exec, calls, store };
}

const auth: Authorization = {
  workflowId: "live_2f1c0b8e-0d1a-4a2e-9d3f-6b1c0a7e5d44",
  purpose: "baseline-probe",
  destination: "+15555550100",
  contractVersion: "live-v1",
};

test("the key is derived from the authorization, so it does not move between attempts", async () => {
  const first = deriveIdempotencyKey(auth, "calls-api");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = deriveIdempotencyKey(auth, "calls-api");
  assert.equal(first, second, "the same authorization has to produce the same key");
  assert.ok(!/\d{10}/.test(first), "a timestamp in the key would make every retry a new call");
});

test("the two lanes of one press are two authorizations", () => {
  const asked = deriveIdempotencyKey({ ...auth, purpose: "who-answered-probe" }, "calls-api");
  assert.notEqual(deriveIdempotencyKey(auth, "calls-api"), asked);
});

test("reserving twice returns the first record rather than making a second", async () => {
  const { exec, store } = fakeRedis();
  const intents = new RedisIntents(exec);

  const first = await intents.reserve(auth, "calls-api");
  const second = await intents.reserve(auth, "calls-api");

  assert.equal(first.fresh, true);
  assert.equal(second.fresh, false, "the second press of the same intent is not fresh");
  assert.equal(second.intent.id, first.intent.id);
  assert.equal(store.size, 1, "one authorization, one record");
});

test("a bound intent hands the same call back instead of dialling again", async () => {
  const { exec } = fakeRedis();
  const intents = new RedisIntents(exec);

  const { intent } = await intents.reserve(auth, "calls-api");
  const sent = await intents.advance(intent, "submission_unknown");
  await intents.advance(sent, "accepted", { boundId: "call_abc" });

  const again = await intents.reserve(auth, "calls-api");
  assert.equal(again.fresh, false);
  assert.equal(again.intent.boundId, "call_abc");
  assert.equal(again.intent.state, "accepted");
});

test("a submission whose outcome is unknown has no way back to reserved", async () => {
  const { exec } = fakeRedis();
  const intents = new RedisIntents(exec);

  const { intent } = await intents.reserve(auth, "calls-api");
  const sent = await intents.advance(intent, "submission_unknown");

  await assert.rejects(
    () => intents.advance(sent, "reserved"),
    /cannot go from submission_unknown to reserved/,
  );

  const found = await intents.find(auth, "calls-api");
  assert.equal(found?.state, "submission_unknown");
  assert.match(haltReason(found!), /may or may not have gone out/);
});

test("an intent cannot be rebound to a second call id", async () => {
  const { exec } = fakeRedis();
  const intents = new RedisIntents(exec);

  const { intent } = await intents.reserve(auth, "calls-api");
  const sent = await intents.advance(intent, "submission_unknown");
  const bound = await intents.advance(sent, "accepted", { boundId: "call_abc" });

  await assert.rejects(
    () => intents.advance(bound, "terminal_unverified", { boundId: "call_def" }),
    /cannot be rebound/,
  );
});

test("an unreadable record is treated as occupied, never overwritten", async () => {
  const { exec, store } = fakeRedis();
  const intents = new RedisIntents(exec);
  store.set(`demo:intent:${deriveIdempotencyKey(auth, "calls-api")}`, "not json");

  await assert.rejects(() => intents.reserve(auth, "calls-api"), /could not be read/);
});

test("intent keys the server will accept", () => {
  assert.equal(validIntentKey(crypto.randomUUID()), true);
  assert.equal(validIntentKey("short"), false);
  assert.equal(validIntentKey("../../etc/passwd-aaaaaaaa"), false);
  assert.equal(validIntentKey(42), false);
  assert.equal(validIntentKey(undefined), false);
});
