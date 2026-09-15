/**
 * End-to-end mock mission — ZERO live calls.
 * Slot Recovery A declined → B early-yes unresolved blocks C → recover path demo.
 */
import { MockCalleAdapter } from "../../src/calle/mock-adapter.js";
import { IntentDispatcher } from "../../src/runtime/dispatcher.js";
import { MissionRuntime } from "../../src/runtime/mission-runtime.js";
import type { CanonicalCallPayload } from "../../src/runtime/types.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function makePayload(label: string): CanonicalCallPayload {
  return {
    task: `Mock ${label}: ask exact confirmation for Friday 15:00. Do not book.`,
    recipients: [{ phones: ["+490000000000"], region: "DE", locale: "de-DE" }],
    metadata: { label, continuum: "mock-mission" },
    recipient_result_schema: {
      type: "object",
      required: ["acceptance"],
      properties: {
        acceptance: {
          type: "string",
          enum: ["candidate_accepted", "declined", "unresolved"],
        },
      },
    },
  };
}

const rt = new MissionRuntime();
const mock = new MockCalleAdapter();
const dispatcher = new IntentDispatcher(rt, mock, {
  now: new Date("2026-08-03T12:00:00+02:00"),
});

const mission = rt.createMission({
  client_request_id: "mock-mission-1",
  mission_idempotency_key: "mock:slot-recovery:v1",
  template_id: "slot-recovery",
  template_version: 1,
  graph_snapshot: { candidates: ["A", "B", "C"] },
});

// --- A: declined ---
const taskA = rt.addTask(mission.mission_id, "Waitlist A", "A");
const intentA = rt.authorizeIntent({
  call_task_id: taskA.call_task_id,
  attempt_no: 1,
  payload: makePayload("A"),
  consent_recorded: true,
  timezone: "Europe/Berlin",
});
mock.scenarioByKey.set(intentA.provider_idempotency_key, "declined");
const dA = await dispatcher.dispatch(intentA.call_intent_id);
assert(dA.ok, "A dispatch");
const termA = await dispatcher.ingestTerminal(intentA.call_intent_id);
assert(termA.outcome === "declined", "A declined");
assert(
  rt.tryUnlockNext({
    mission_id: mission.mission_id,
    upstream_intent_id: intentA.call_intent_id,
  }).ok,
  "A unlocks B",
);

// --- B: lost response → ambiguous → recover same key ---
const taskB = rt.addTask(mission.mission_id, "Waitlist B", "B");
const intentB = rt.authorizeIntent({
  call_task_id: taskB.call_task_id,
  attempt_no: 1,
  payload: makePayload("B"),
  consent_recorded: true,
  timezone: "Europe/Berlin",
});
mock.scenarioByKey.set(intentB.provider_idempotency_key, "early_ja_unresolved");
mock.dropNextResponse = true;
const dB1 = await dispatcher.dispatch(intentB.call_intent_id);
assert(!dB1.ok && dB1.kind === "ambiguous", "B lost response → ambiguous");
assert(
  !rt.tryUnlockNext({
    mission_id: mission.mission_id,
    upstream_intent_id: intentB.call_intent_id,
  }).ok,
  "ambiguous B must not unlock C",
);

const dB2 = await dispatcher.recover(intentB.call_intent_id);
assert(dB2.ok && dB2.reused, "B recover reuses same provider run");
assert(mock.distinctCallCount() === 2, "only A+B provider runs (not 3)");
assert(
  mock.createCount(intentB.provider_idempotency_key) === 2,
  "same key hit twice, one call id",
);

const termB = await dispatcher.ingestTerminal(intentB.call_intent_id);
assert(termB.outcome === "unresolved", "early yes → unresolved");
assert(
  !rt.tryUnlockNext({
    mission_id: mission.mission_id,
    upstream_intent_id: intentB.call_intent_id,
  }).ok,
  "unresolved B must not unlock C",
);

// --- Idempotency: second create same key ---
const again = await mock.createCall({
  idempotency_key: intentA.provider_idempotency_key,
  payload: intentA.canonical_call_payload,
});
assert(
  again.reused &&
    again.call_id === rt.getIntent(intentA.call_intent_id)?.provider_run_id,
  "A key reuse",
);

const verify = rt.events.verify(mission.mission_id);
assert(verify.ok, `chain: ${verify.errors}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: mock.mode,
      live_calls: 0,
      distinct_provider_runs: mock.distinctCallCount(),
      mission_id: mission.mission_id,
      events: verify.eventCount,
      ledger: [
        {
          label: "A",
          state: rt.getIntent(intentA.call_intent_id)?.state,
          outcome: termA.outcome,
          provider_runs: 1,
        },
        {
          label: "B",
          state: rt.getIntent(intentB.call_intent_id)?.state,
          outcome: termB.outcome,
          provider_runs: 1,
          note: "lost→ambiguous→recovered; C blocked",
        },
        { label: "C", state: "pending", provider_runs: 0 },
      ],
      proofs: [
        "mock_adapter_no_live",
        "idempotency_key_reuse",
        "lost_response_ambiguous",
        "recover_same_key",
        "early_ja_unresolved",
        "unresolved_blocks_C",
        "event_chain",
      ],
    },
    null,
    2,
  ),
);
