/**
 * S1–S6 dry/mock ladder — 0 live dials.
 * Live path gated behind SPIKE_LIVE + operator runbook auth.
 */
import { LiveCalleAdapter } from "../../src/calle/live-adapter.js";
import { MockCalleAdapter } from "../../src/calle/mock-adapter.js";
import { IntentDispatcher } from "../../src/runtime/dispatcher.js";
import { MissionRuntime } from "../../src/runtime/mission-runtime.js";
import { assertFrozenPayload } from "../../src/runtime/crypto.js";
import type { CanonicalCallPayload } from "../../src/runtime/types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOON = new Date("2026-08-03T12:00:00+02:00");

// Make this no-call ladder independent from the operator's current shell.
process.env.SPIKE_LIVE = "0";
process.env.SPIKE_STOP = "0";
process.env.CONTINUUM_GLOBAL_STOP_FILE = join(
  tmpdir(),
  `continuum-s1-s6-dry-${process.pid}.stop`,
);

function payload(): CanonicalCallPayload {
  return {
    task: "Spike dry: confirm Friday 15:00. No booking.",
    recipients: [{ phones: ["+490000000000"], region: "DE", locale: "de-DE" }],
    metadata: { spike: "s1-s6-dry" },
  };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const results: Array<{ step: string; ok: boolean }> = [];

function step(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn();
    results.push({ step: name, ok: true });
    console.log(`PASS ${name}`);
  })();
}

await step("S0_live_adapter_refuses_without_SPIKE_LIVE", async () => {
  const live = new LiveCalleAdapter({
    api_key: "test-only-dummy",
    base_url: "https://api.heycall-e.com",
  });
  let code = "";
  try {
    await live.createCall({ idempotency_key: "x", payload: payload() });
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
  }
  assert(code === "LIVE_REFUSED", "must refuse");
});

await step("S1_authorize_intent_mock", async () => {
  const rt = new MissionRuntime();
  const m = rt.createMission({
    client_request_id: "s1",
    mission_idempotency_key: "spike:s1",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const t = rt.addTask(m.mission_id, "A", "A");
  const i = rt.authorizeIntent({
    call_task_id: t.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  assert(i.state === "planned", "planned");
});

await step("S2_dispatch_mock", async () => {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const d = new IntentDispatcher(rt, mock, { now: NOON });
  const m = rt.createMission({
    client_request_id: "s2",
    mission_idempotency_key: "spike:s2",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const t = rt.addTask(m.mission_id, "A", "A");
  const i = rt.authorizeIntent({
    call_task_id: t.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(i.provider_idempotency_key, "declined");
  const r = await d.dispatch(i.call_intent_id);
  assert(r.ok, "dispatch");
});

await step("S3_ingest_terminal", async () => {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const d = new IntentDispatcher(rt, mock, { now: NOON });
  const m = rt.createMission({
    client_request_id: "s3",
    mission_idempotency_key: "spike:s3",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const t = rt.addTask(m.mission_id, "A", "A");
  const i = rt.authorizeIntent({
    call_task_id: t.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(i.provider_idempotency_key, "declined");
  await d.dispatch(i.call_intent_id);
  const term = await d.ingestTerminal(i.call_intent_id);
  assert(term.outcome === "declined", "declined");
});

await step("S4_idempotency_reuse", async () => {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const d = new IntentDispatcher(rt, mock, { now: NOON });
  const m = rt.createMission({
    client_request_id: "s4",
    mission_idempotency_key: "spike:s4",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const t = rt.addTask(m.mission_id, "A", "A");
  const i = rt.authorizeIntent({
    call_task_id: t.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  await d.dispatch(i.call_intent_id);
  mock.dropNextResponse = false;
  // second create with same key via recover path after fake ambiguous
  const created = await mock.createCall({
    idempotency_key: i.provider_idempotency_key,
    payload: i.canonical_call_payload,
  });
  assert(created.reused, "reuse");
});

await step("S5_lost_response_recover", async () => {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const d = new IntentDispatcher(rt, mock, { now: NOON });
  const m = rt.createMission({
    client_request_id: "s5",
    mission_idempotency_key: "spike:s5",
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: {},
  });
  const t = rt.addTask(m.mission_id, "B", "B");
  const i = rt.authorizeIntent({
    call_task_id: t.call_task_id,
    attempt_no: 1,
    payload: payload(),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.dropNextResponse = true;
  await d.dispatch(i.call_intent_id);
  const rec = await d.recover(i.call_intent_id);
  assert(rec.ok && mock.distinctCallCount() === 1, "recover one run");
});

await step("S6_payload_change_reject", () => {
  const p = payload();
  const changed = payload();
  changed.task = "CHANGED";
  let code = "";
  try {
    assertFrozenPayload("intent_x", p, changed);
  } catch (e) {
    code = (e as { code?: string }).code ?? "";
  }
  assert(code === "PAYLOAD_CHANGED", "reject");
});

console.log(
  JSON.stringify(
    {
      ok: true,
      live_calls: 0,
      mode: "dry/mock",
      steps: results,
      next: "Complete the operator runbook auth, then SPIKE_LIVE=1 named experiments only",
    },
    null,
    2,
  ),
);
