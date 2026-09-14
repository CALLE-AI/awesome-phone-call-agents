/**
 * Dry chaos proofs — no live CALL-E dials.
 */
import { assertFrozenPayload } from "../../src/runtime/crypto.js";
import { MissionRuntime } from "../../src/runtime/mission-runtime.js";
import { evaluateVerbalConfirmation } from "../../src/runtime/transitions.js";
import type { CanonicalCallPayload } from "../../src/runtime/types.js";

function payload(phone = "+490000000000"): CanonicalCallPayload {
  return {
    task: "Ask about Friday 15:00 slot. Confirm only after exact question.",
    recipients: [{ phones: [phone], region: "DE", locale: "de-DE" }],
    metadata: { continuum_spike: "dry" },
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const rt = new MissionRuntime();

const m1 = rt.createMission({
  client_request_id: "req_1",
  mission_idempotency_key: "slot-recovery:demo:v1",
  template_id: "slot-recovery",
  template_version: 1,
  graph_snapshot: { steps: ["A", "B", "C"] },
});
const m2 = rt.createMission({
  client_request_id: "req_1",
  mission_idempotency_key: "slot-recovery:demo:v1",
  template_id: "slot-recovery",
  template_version: 1,
  graph_snapshot: { steps: ["A", "B", "C"] },
});
assert(m1.mission_id === m2.mission_id, "double-start must return same mission");
let missionConflictRejected = false;
try {
  rt.createMission({
    client_request_id: "req_1",
    mission_idempotency_key: "slot-recovery:demo:v1",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: { steps: ["CHANGED"] },
  });
} catch (error) {
  missionConflictRejected =
    (error as { code?: string }).code === "MISSION_IDEMPOTENCY_CONFLICT";
}
assert(missionConflictRejected, "same mission key with changed input must reject");
assert(
  JSON.stringify(m1.graph_snapshot) === JSON.stringify({ steps: ["A", "B", "C"] }),
  "frozen graph snapshot must not change",
);

const taskB = rt.addTask(m1.mission_id, "Call waitlist B", "Waitlist B");
const intentB = rt.authorizeIntent({
  call_task_id: taskB.call_task_id,
  attempt_no: 1,
  payload: payload(),
  consent_recorded: true,
  timezone: "Europe/Berlin",
});

let rejected = false;
try {
  const changed = payload();
  changed.task = "CHANGED";
  assertFrozenPayload(
    intentB.call_intent_id,
    intentB.canonical_call_payload,
    changed,
  );
} catch (e) {
  rejected = (e as { code?: string }).code === "PAYLOAD_CHANGED";
}
assert(rejected, "payload change must reject");

rt.beginDispatch(intentB.call_intent_id);
rt.markAmbiguous(intentB.call_intent_id, "lost_response_simulated");
const unlock = rt.tryUnlockNext({
  mission_id: m1.mission_id,
  upstream_intent_id: intentB.call_intent_id,
});
assert(!unlock.ok, "ambiguous must not unlock C");
assert(
  rt.getMission(m1.mission_id)?.status === "blocked_needs_resolution",
  "mission must block",
);

const taskA = rt.addTask(m1.mission_id, "Call waitlist A", "Waitlist A");
const intentA = rt.authorizeIntent({
  call_task_id: taskA.call_task_id,
  attempt_no: 1,
  payload: payload(),
  consent_recorded: true,
  timezone: "Europe/Berlin",
});
let conflictingDispatchRejected = false;
try {
  rt.beginDispatch(intentA.call_intent_id);
} catch (error) {
  conflictingDispatchRejected = [
    "MISSION_NOT_RUNNING",
    "MISSION_HAS_STUCK_INTENT",
  ].includes((error as { code?: string }).code ?? "");
}
assert(
  conflictingDispatchRejected,
  "a new intent must not dispatch while another intent is ambiguous",
);

rt.recoverProviderRun(intentB.call_intent_id, "run_fake_82");
rt.completeIntent(intentB.call_intent_id, "declined", "dry-chaos:recovered-declined");
rt.beginDispatch(intentA.call_intent_id);
rt.attachProviderRun(intentA.call_intent_id, "run_fake_81");
rt.completeIntent(intentA.call_intent_id, "declined", "dry-chaos:manual-declined");
const unlockAfterRecovery = rt.tryUnlockNext({
  mission_id: m1.mission_id,
  upstream_intent_id: intentA.call_intent_id,
});
assert(unlockAfterRecovery.ok, "declined may unlock after all ambiguity is resolved");

for (const [id, n] of rt.providerRunsPerIntent()) {
  assert(n <= 1, `intent ${id} has ${n} runs`);
}

const early = evaluateVerbalConfirmation({
  confirmationQuestionAsked: false,
  answerAfterQuestion: false,
  slotMatchesOfferedFact: true,
  schemaValid: true,
  transcriptResultConflict: false,
  reliableTranscript: true,
});
assert(early === "unresolved", "early yes must be unresolved");

const good = evaluateVerbalConfirmation({
  confirmationQuestionAsked: true,
  answerAfterQuestion: true,
  slotMatchesOfferedFact: true,
  schemaValid: true,
  transcriptResultConflict: false,
  reliableTranscript: true,
});
assert(good === "verbally_confirmed", "full contract must confirm");

rt.requestCancel(m1.mission_id, "operator_stop");
assert(
  rt.getMission(m1.mission_id)?.status === "cancellation_requested",
  "in-flight mission cancel → cancellation_requested",
);

const verify = rt.events.verify(m1.mission_id);
assert(verify.ok && verify.chainIntact, `event chain broken: ${verify.errors}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      mission_id: m1.mission_id,
      events: verify.eventCount,
      proofs: [
    "double_start_idempotent",
    "double_start_conflict_rejected",
        "payload_change_reject",
        "ambiguous_blocks_C",
        "declined_unlocks",
        "le_1_provider_run",
        "confirmation_hard_rule",
        "cancel_inflight_requested",
        "event_hash_chain",
      ],
    },
    null,
    2,
  ),
);
