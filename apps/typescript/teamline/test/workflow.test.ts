import assert from "node:assert/strict";
import test from "node:test";
import type { CallProvider, ProviderResult, StartRequest } from "../src/provider.js";
import { CallCreateError, SandboxProvider } from "../src/provider.js";
import { TeamLineWorkflow } from "../src/workflow.js";

const phone = "+12025550142";

class FakeProvider implements CallProvider {
  readonly mode = "live" as const;
  readonly starts: StartRequest[] = [];
  readonly gets: string[] = [];
  result: ProviderResult = { status: "in_progress" };
  startGate?: Promise<void>;
  startError?: Error;
  startId?: string;
  getGate?: Promise<void>;
  getError?: Error;
  async start(request: StartRequest) {
    this.starts.push(structuredClone(request));
    if (this.startGate) await this.startGate;
    if (this.startError) throw this.startError;
    return { id: this.startId ?? `call-${this.starts.length}` };
  }
  async get(id: string) {
    this.gets.push(id);
    if (this.getGate) await this.getGate;
    if (this.getError) throw this.getError;
    return structuredClone(this.result);
  }
}

const input = (_label: string) => ({ phone, consent: true });

test("sandbox completes the two-call workflow without credentials or telephone calls", async () => {
  const provider = new SandboxProvider();
  const workflow = new TeamLineWorkflow(provider);
  await workflow.launchFacility(input("facility-fixture"));
  assert.equal((await workflow.check("facility")).decision, "awaiting_coach");
  workflow.approveFacilityDecision();
  await workflow.launchParent(input("parent-fixture"));
  const final = await workflow.check("parent");
  assert.equal(final.parent?.status, "completed");
  assert.equal(provider.starts.length, 2);
  assert.equal(JSON.stringify(final).includes(phone), false);
  assert.equal(JSON.stringify(final).includes("providerCallId"), false);
});

test("consent, phone validation, and coach approval are required", async () => {
  const workflow = new TeamLineWorkflow(new FakeProvider());
  await assert.rejects(() => workflow.launchFacility({ ...input("no-consent"), consent: false }), /consent/i);
  await assert.rejects(() => workflow.launchFacility({ ...input("bad-phone"), phone: "555-0100" }), /valid US phone/i);
  await assert.rejects(() => workflow.launchParent(input("parent-locked")), /locked/i);
});

test("result retrieval failure stays unresolved and checks the same call without redial", async () => {
  const provider = new FakeProvider();
  const workflow = new TeamLineWorkflow(provider);
  await workflow.launchFacility(input("facility-once"));
  provider.getError = new Error("temporary retrieval failure");
  await assert.rejects(() => workflow.check("facility"), /temporary retrieval failure/);
  assert.equal(workflow.state().facility?.status, "in_progress");
  assert.equal(provider.starts.length, 1);
  await assert.rejects(() => workflow.retryFacility(input("retry-blocked")), /provider-confirmed no-answer/i);
  delete provider.getError;
  provider.result = confirmedFacility();
  assert.equal((await workflow.check("facility")).facility?.status, "completed");
  assert.deepEqual(provider.gets, ["call-1", "call-1"]);
  assert.equal(provider.starts.length, 1);
});

test("an accepted create whose response times out persists one unresolved server-owned intent", async () => {
  const provider = new FakeProvider();
  provider.startError = new Error("network timeout after provider acceptance");
  const workflow = new TeamLineWorkflow(provider, Date.now, () => "stable-intent");

  await assert.rejects(() => workflow.launchFacility(input("browser-key-is-not-used")), /may have accepted/i);
  assert.equal(provider.starts.length, 1);
  assert.equal(provider.starts[0]!.idempotencyKey, "teamline-facility-stable-intent");
  assert.equal(workflow.state().facility?.status, "create_uncertain");

  await assert.rejects(() => workflow.launchFacility(input("fresh-browser-attempt-1")), /already exists/i);
  await assert.rejects(() => workflow.launchFacility(input("fresh-browser-attempt-2")), /already exists/i);
  assert.equal(provider.starts.length, 1, "repeated starts must not dispatch another provider create");

  const publicState = JSON.stringify(workflow.state());
  assert.doesNotMatch(publicState, /stable-intent|idempotency|fingerprint|providerCallId|call-1/);
  assert.doesNotMatch(publicState, new RegExp(phone.replace("+", "\\+")));
});

test("explicit reconciliation reuses the unresolved intent and normal result checks never create", async () => {
  const provider = new FakeProvider();
  provider.startError = new Error("ambiguous connection loss");
  const workflow = new TeamLineWorkflow(provider, Date.now, () => "reconcile-me");

  await assert.rejects(() => workflow.launchFacility(input("initial")), /may have accepted/i);
  delete provider.startError;
  await workflow.reconcileFacility(input("same-number"));

  assert.equal(provider.starts.length, 2, "reconciliation may resubmit only the existing logical intent");
  assert.equal(provider.starts[0]!.idempotencyKey, provider.starts[1]!.idempotencyKey);
  assert.equal(workflow.state().facility?.status, "in_progress");
  provider.result = confirmedFacility();
  await workflow.check("facility");
  assert.equal(provider.starts.length, 2, "checking the reconciled call must not dispatch create");
  assert.deepEqual(provider.gets, ["call-2"]);
});

test("reconciliation requires the same authorized number and retains uncertainty on another timeout", async () => {
  const provider = new FakeProvider();
  provider.startError = new Error("ambiguous timeout");
  const workflow = new TeamLineWorkflow(provider, Date.now, () => "same-intent");

  await assert.rejects(() => workflow.launchFacility(input("initial")), /may have accepted/i);
  await assert.rejects(
    () => workflow.reconcileFacility({ phone: "+12025550143", consent: true }),
    /same authorized phone number/i,
  );
  assert.equal(provider.starts.length, 1);
  await assert.rejects(() => workflow.reconcileFacility(input("reconcile")), /remains unresolved/i);
  assert.equal(provider.starts.length, 2);
  assert.equal(provider.starts[0]!.idempotencyKey, provider.starts[1]!.idempotencyKey);
  assert.equal(workflow.state().facility?.status, "create_uncertain");
});

test("a malformed create response without an identifier remains an unresolved intent", async () => {
  const provider = new FakeProvider();
  provider.startId = "";
  const workflow = new TeamLineWorkflow(provider, Date.now, () => "malformed-response");

  await assert.rejects(() => workflow.launchFacility(input("malformed")), /may have accepted/i);
  assert.equal(workflow.state().facility?.status, "create_uncertain");
  await assert.rejects(() => workflow.launchFacility(input("again")), /already exists/i);
  assert.equal(provider.starts.length, 1);
});

test("definitive rejection while reconciling a retry restores the provider-confirmed no-answer", async () => {
  let now = 0;
  const provider = new FakeProvider();
  const workflow = new TeamLineWorkflow(provider, () => now, () => `intent-${provider.starts.length + 1}`);
  await workflow.launchFacility(input("first"));
  provider.result = { status: "failed", failureCode: "no_answer" };
  await workflow.check("facility");
  now = 10_000;
  provider.startError = new Error("ambiguous retry response");
  await assert.rejects(() => workflow.retryFacility(input("retry")), /may have accepted/i);
  provider.startError = new CallCreateError("not_created", "Provider explicitly rejected creation.");
  await assert.rejects(() => workflow.reconcileFacility(input("reconcile")), /explicitly rejected/i);

  assert.equal(workflow.state().facility?.status, "no_answer");
  assert.equal(workflow.state().facility?.previousNoAnswerAttempts, 0);
});

test("provider-confirmed no answer enables one explicit retry after cooldown", async () => {
  let now = 0;
  const provider = new FakeProvider();
  const workflow = new TeamLineWorkflow(provider, () => now);
  await workflow.launchFacility(input("facility-first"));
  provider.result = { status: "failed", failureCode: "voicemail_detected" };
  assert.equal((await workflow.check("facility")).facility?.status, "no_answer");
  assert.equal(provider.starts.length, 1, "no automatic redial");
  await assert.rejects(() => workflow.retryFacility(input("facility-too-soon")), /10 seconds/i);
  now = 10_000;
  await workflow.retryFacility(input("facility-second"));
  assert.equal(provider.starts.length, 2);
  assert.notEqual(provider.starts[0]!.idempotencyKey, provider.starts[1]!.idempotencyKey);
  assert.equal(workflow.state().facility?.previousNoAnswerAttempts, 1);
});

test("parent no answer also requires an explicit retry and preserves the prior attempt", async () => {
  let now = 0;
  const provider = new FakeProvider();
  const workflow = new TeamLineWorkflow(provider, () => now);
  await workflow.launchFacility(input("facility-before-parent"));
  provider.result = confirmedFacility();
  await workflow.check("facility");
  workflow.approveFacilityDecision();
  await workflow.launchParent(input("parent-first"));
  provider.result = { status: "completed", structuredResult: { outcome: "no_answer" } };
  assert.equal((await workflow.check("parent")).parent?.status, "no_answer");
  assert.equal(provider.starts.length, 2, "checking no answer must not redial");
  now = 10_000;
  await workflow.retryParent(input("parent-second"));
  assert.equal(provider.starts.length, 3);
  assert.equal(workflow.state().parent?.previousNoAnswerAttempts, 1);
});

test("concurrent duplicate starts are rejected and successful calls cannot be retried", async () => {
  let release!: () => void;
  const provider = new FakeProvider();
  provider.startGate = new Promise<void>((resolve) => { release = resolve; });
  const workflow = new TeamLineWorkflow(provider);
  const first = workflow.launchFacility(input("facility-concurrent"));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => workflow.launchFacility(input("facility-duplicate")), /already being submitted/i);
  release();
  await first;
  provider.result = confirmedFacility();
  await workflow.check("facility");
  await assert.rejects(() => workflow.retryFacility(input("facility-after-success")), /provider-confirmed no-answer/i);
});

test("concurrent result checks are rejected without creating another call", async () => {
  let release!: () => void;
  const provider = new FakeProvider();
  const workflow = new TeamLineWorkflow(provider);
  await workflow.launchFacility(input("facility-check-once"));
  provider.getGate = new Promise<void>((resolve) => { release = resolve; });
  const first = workflow.check("facility");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => workflow.check("facility"), /already being checked/i);
  assert.equal(provider.starts.length, 1);
  release();
  await first;
});

test("public structured results allowlist fields and mask phone-like text", async () => {
  const provider = new FakeProvider();
  const workflow = new TeamLineWorkflow(provider);
  await workflow.launchFacility(input("facility-redaction"));
  provider.result = confirmedFacility();
  provider.result.structuredResult = {
    ...provider.result.structuredResult,
    conflict_reason: "Call +1 303-555-0199 about the other event",
    transcript: "private provider artifact",
  };
  const state = await workflow.check("facility");
  const serialized = JSON.stringify(state);
  assert.match(serialized, /\[masked phone\]/);
  assert.doesNotMatch(serialized, /303-555-0199|private provider artifact|transcript/);
});

test("facility and parent calls use separate bounded schemas and authority instructions", async () => {
  const provider = new FakeProvider();
  const workflow = new TeamLineWorkflow(provider);
  await workflow.launchFacility(input("facility-contract"));
  assert.match(provider.starts[0]!.objective, /only the coach can decide/i);
  assert.deepEqual(Object.keys(provider.starts[0]!.resultSchema.properties as object), [
    "outcome", "original_practice_time", "original_practice_possible", "field_available_time",
    "player_arrival_time", "conflict_reason", "unresolved_questions", "commitment_requests",
  ]);
  provider.result = confirmedFacility();
  await workflow.check("facility");
  workflow.approveFacilityDecision();
  await workflow.launchParent(input("parent-contract"));
  assert.match(provider.starts[1]!.objective, /coach-approved/i);
  assert.match(provider.starts[1]!.objective, /Do not arrange transportation/i);
  assert.deepEqual(Object.keys(provider.starts[1]!.resultSchema.properties as object), [
    "outcome", "attendance", "transportation_needed", "coach_follow_up_requested",
  ]);
});

function confirmedFacility(): ProviderResult {
  return {
    status: "completed",
    structuredResult: {
      outcome: "confirmed",
      original_practice_time: "4:30 PM",
      original_practice_possible: false,
      field_available_time: "5:30 PM",
      player_arrival_time: "5:00 PM",
      conflict_reason: "another event is using the stadium",
      unresolved_questions: [],
      commitment_requests: [],
    },
  };
}
