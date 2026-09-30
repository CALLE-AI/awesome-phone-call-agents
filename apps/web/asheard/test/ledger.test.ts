import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  IllegalTransitionError,
  MemoryIntentStore,
  type Authorization,
  deriveIdempotencyKey,
  isDialBlocked,
  maskDestination,
  reconcile,
  redact,
  runBindingChecks,
} from "asheard/ledger";

const here = dirname(fileURLToPath(import.meta.url));
// Locate the package's own fixtures through a subpath it actually exports,
// so the suite reads the same files the app imports at runtime.
const fixturesRoot = join(
  dirname(
    createRequire(import.meta.url).resolve(
      "asheard/fixtures/calls-api/failed-opaque.json",
    ),
  ),
  "..",
);

function fixture(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixturesRoot, relative), "utf8"));
}

const AUTH: Authorization = {
  workflowId: "wf_1001",
  purpose: "confirm the Saturday opening hours",
  destination: "+15551234567",
  contractVersion: "v1",
};

test("the idempotency key comes from the authorization, not the attempt", () => {
  const a = deriveIdempotencyKey(AUTH, "calls-api");
  const b = deriveIdempotencyKey({ ...AUTH }, "calls-api");
  assert.equal(a, b, "the same authorization must always produce the same key");
});

test("changing anything the caller was authorized to do changes the key", () => {
  const base = deriveIdempotencyKey(AUTH, "calls-api");
  assert.notEqual(base, deriveIdempotencyKey({ ...AUTH, destination: "+15559999999" }, "calls-api"));
  assert.notEqual(base, deriveIdempotencyKey({ ...AUTH, purpose: "something else" }, "calls-api"));
  assert.notEqual(base, deriveIdempotencyKey({ ...AUTH, contractVersion: "v2" }, "calls-api"));
  assert.notEqual(base, deriveIdempotencyKey(AUTH, "mcp"), "a different door is a different key");
});

test("reserving the same authorization twice does not create a second call", async () => {
  const store = new MemoryIntentStore();
  const first = await store.reserve(AUTH, "calls-api");
  const second = await store.reserve(AUTH, "calls-api");
  assert.equal(second.id, first.id);
  assert.equal(second.state, "reserved");
});

test("a number is masked everywhere it could be read", () => {
  assert.equal(maskDestination("+15551234567"), "+15*******67");
  const store = new MemoryIntentStore();
  return store.reserve(AUTH, "calls-api").then((intent) => {
    const safe = redact(intent);
    assert.equal(safe.authorization.destination, "+15*******67");
    assert.ok(!JSON.stringify(safe).includes("5551234567"), "the dialable number must not survive redaction");
  });
});

test("once a submission is ambiguous the intent can never go back to reserved", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "mcp");
  const unknown = await store.advance(intent.id, "submission_unknown");
  assert.equal(unknown.state, "submission_unknown");
  await assert.rejects(
    () => store.advance(intent.id, "reserved"),
    IllegalTransitionError,
    "pretending the request never left is how somebody gets called twice",
  );
});

test("only a reserved intent is allowed to dial", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "mcp");
  assert.equal(isDialBlocked(intent), false);
  const unknown = await store.advance(intent.id, "submission_unknown");
  assert.equal(isDialBlocked(unknown), true, "an ambiguous submission must not redial");
});

test("the recovery secret never comes back from an ordinary read", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "mcp");
  await store.putRecoverySecret(intent.id, { planId: "plan_123", confirmToken: "tok_secret" });

  const read = await store.get(intent.id);
  assert.ok(read);
  assert.ok(!JSON.stringify(read).includes("tok_secret"), "a routine read must not carry the token");

  const secret = await store.takeRecoverySecret(intent.id);
  assert.equal(secret?.confirmToken, "tok_secret");
});

test("an intent cannot be rebound to a different call", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "calls-api");
  await store.advance(intent.id, "accepted", { boundId: "call_fixture_001" });
  await assert.rejects(() => store.advance(intent.id, "needs_human", { boundId: "call_other" }));
});

test("a payload from another call fails the binding check and stops there", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "calls-api");
  await store.advance(intent.id, "accepted", { boundId: "call_something_else" });

  const outcome = await reconcile(store, intent.id, fixture("calls-api/completed-no-answered-by.json"));
  assert.equal(outcome.state, "needs_human");
  assert.equal(outcome.disposition, null, "a payload that failed binding is never even read");
  assert.ok(outcome.reasons.some((r) => r.includes("call-id")));
});

test("a call to a number nobody approved fails the binding check", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve({ ...AUTH, destination: "+15550000000" }, "calls-api");
  await store.advance(intent.id, "accepted", { boundId: "call_fixture_001" });

  const payload = fixture("calls-api/completed-no-answered-by.json");
  (payload.recipients as Array<{ phones: string[] }>)[0]!.phones = ["+15551234567"];

  const outcome = await reconcile(store, intent.id, payload);
  assert.equal(outcome.state, "needs_human");
  assert.ok(outcome.reasons.some((r) => r.includes("destination")));
  assert.ok(!JSON.stringify(outcome).includes("15551234567"), "reasons must not leak a dialable number");
});

test("an expired authorization is not rescued by a good result", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(
    { ...AUTH, notAfter: "2020-01-01T00:00:00Z" },
    "goal-runs",
  );
  await store.advance(intent.id, "accepted", { boundId: "rgrp_fixture_103" });

  const outcome = await reconcile(store, intent.id, fixture("goal-runs/result-ok.json"));
  assert.equal(outcome.state, "needs_human");
  assert.ok(outcome.reasons.some((r) => r.includes("authorization-window")));
});

test("an unbound intent cannot verify anything", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "calls-api");
  const checks = runBindingChecks(intent, fixture("calls-api/completed-no-answered-by.json"));
  const callId = checks.find((c) => c.name === "call-id");
  assert.equal(callId?.passed, false);
});

test("a bound, in-window, matching payload still routes to a human when the reading is uncertain", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "calls-api");
  await store.advance(intent.id, "accepted", { boundId: "call_fixture_001" });

  // Fixtures carry CALL-E's documented <E164_PHONE> placeholder, so the test
  // supplies the approved number to get past the destination check.
  const payload = fixture("calls-api/completed-no-answered-by.json");
  (payload.recipients as Array<{ phones: string[] }>)[0]!.phones = [AUTH.destination];

  const outcome = await reconcile(store, intent.id, payload);
  assert.ok(outcome.checks.every((c) => c.passed), "every binding check should pass here");
  assert.equal(outcome.state, "needs_human");
  assert.ok(outcome.disposition, "the payload was read, unlike a binding failure");
  assert.equal(outcome.disposition?.endstate.value, "answered_unspecified");
});

test("a clean Goal Run verifies, and Goal Runs not echoing the phone is recorded honestly", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "goal-runs");
  await store.advance(intent.id, "accepted", { boundId: "rgrp_fixture_103" });

  const outcome = await reconcile(store, intent.id, fixture("goal-runs/result-ok.json"));
  const destination = outcome.checks.find((c) => c.name === "destination");
  assert.ok(destination?.detail.includes("never echoes the phone back"));
  // The endstate here is derived, so the reading is honest about needing review.
  assert.equal(outcome.state, "needs_human");
  assert.equal(outcome.disposition?.endstate.basis, "derived");
});

test("a clean unsuccessful ending verifies, because we know exactly what happened", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "mcp");
  await store.advance(intent.id, "accepted", { boundId: "run_mcp_voicemail" });
  const outcome = await reconcile(store, intent.id, fixture("mcp/voicemail.json"));

  assert.equal(outcome.disposition?.endstate.value, "answered_machine");
  assert.equal(outcome.disposition?.taskOutcome.value, "not_met");

  // needs_human means we cannot tell what happened, not that what happened was
  // bad. A quoted voicemail with the task undone is a complete fact. It wants a
  // retry policy, not a person squinting at it. Routing every not_met to review
  // would bury the queue in calls nobody needs to look at.
  assert.equal(outcome.state, "terminal_verified");

  await assert.rejects(() => store.advance(intent.id, "accepted"), IllegalTransitionError);
});

test("a refused payload says why it was refused, in words an operator can read", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "calls-api");
  await store.advance(intent.id, "accepted", { boundId: "call_something_else" });

  const outcome = await reconcile(store, intent.id, fixture("calls-api/completed-no-answered-by.json"));

  assert.equal(outcome.disposition, null);
  assert.ok(outcome.notRead, "a refusal must carry its own record, not just an absent disposition");
  assert.equal(outcome.notRead?.code, "binding_failed");
  assert.match(outcome.notRead!.summary, /^This result was not read\./);
  assert.match(outcome.notRead!.summary, /different call/);
  assert.match(outcome.notRead!.summary, /still unaccounted for/);
  assert.ok(outcome.notRead!.failedChecks.length > 0);
  assert.ok(outcome.notRead!.failedChecks.every((c) => c.detail.length > 0));
});

test("every failed check contributes a sentence, and a masked number never leaks into one", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(
    { ...AUTH, destination: "+15550000000", notAfter: "2020-01-01T00:00:00Z" },
    "calls-api",
  );
  await store.advance(intent.id, "accepted", { boundId: "call_elsewhere" });

  const payload = fixture("calls-api/completed-no-answered-by.json");
  (payload.recipients as Array<{ phones: string[] }>)[0]!.phones = ["+15551234567"];

  const outcome = await reconcile(store, intent.id, payload);
  const summary = outcome.notRead!.summary;

  assert.match(summary, /different call/);
  assert.match(summary, /number nobody approved/);
  assert.match(summary, /already run out/);
  assert.ok(!JSON.stringify(outcome).includes("15551234567"), "no dialable number in a refusal");
});

test("exactly one of disposition and notRead is ever set", async () => {
  const store = new MemoryIntentStore();
  const intent = await store.reserve(AUTH, "mcp");
  await store.advance(intent.id, "accepted", { boundId: "run_mcp_voicemail" });
  const good = await reconcile(store, intent.id, fixture("mcp/voicemail.json"));
  assert.ok(good.disposition);
  assert.equal(good.notRead, null);

  const other = new MemoryIntentStore();
  const bad = await other.reserve(AUTH, "mcp");
  await other.advance(bad.id, "accepted", { boundId: "run_somewhere_else" });
  const refused = await reconcile(other, bad.id, fixture("mcp/voicemail.json"));
  assert.equal(refused.disposition, null);
  assert.ok(refused.notRead);
});
