/**
 * Seeded chaos scale — replays F1–F12 matrix scenarios n times.
 * Usage: npx tsx scripts/spike/chaos-scale.ts --n=100
 * Writes artifacts/chaos/summary.json
 *
 * 0 live dials.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { IntentDispatcher } from "../../src/runtime/dispatcher.js";
import { MissionRuntime } from "../../src/runtime/mission-runtime.js";
import { verifyEvidencePack } from "../../src/runtime/evidence.js";
import { MockCalleAdapter } from "../../src/calle/mock-adapter.js";
import type { CanonicalCallPayload } from "../../src/runtime/types.js";

const NOON = new Date("2026-08-03T12:00:00+02:00");

function parseN(): number {
  const arg = process.argv.find((a) => a.startsWith("--n="));
  return Math.max(1, Number(arg?.slice(4) || process.env.CHAOS_N || 100));
}

function payload(seed: string): CanonicalCallPayload {
  return {
    task: `Chaos ${seed}: confirm Friday 15:00 only. No booking.`,
    recipients: [{ phones: ["+490000000000"], region: "DE", locale: "de-DE" }],
    metadata: { continuum: "chaos", seed },
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

function seedKey(n: number, label: string): string {
  return createHash("sha256").update(`${n}:${label}`).digest("hex").slice(0, 12);
}

async function scenarioLostRecover(i: number): Promise<void> {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const dispatcher = new IntentDispatcher(rt, mock, { now: NOON });
  const m = rt.createMission({
    client_request_id: `c-${i}-lost`,
    mission_idempotency_key: `chaos:lost:${seedKey(i, "lost")}`,
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: { i },
  });
  const task = rt.addTask(m.mission_id, "B", "B");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(seedKey(i, "lost")),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.dropNextResponse = true;
  await dispatcher.dispatch(intent.call_intent_id);
  await dispatcher.recover(intent.call_intent_id);
  await dispatcher.ingestTerminal(intent.call_intent_id);
  assert(mock.distinctCallCount() === 1, "lost recover ≤1 run");
  const v = verifyEvidencePack(rt.exportEvidencePack(m.mission_id));
  assert(v.ok && v.illegal_unresolved_unlocks === 0, v.errors.join("; "));
}

async function scenarioAmbiguousBlock(i: number): Promise<void> {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const dispatcher = new IntentDispatcher(rt, mock, { now: NOON });
  const m = rt.createMission({
    client_request_id: `c-${i}-amb`,
    mission_idempotency_key: `chaos:amb:${seedKey(i, "amb")}`,
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: { i },
  });
  const task = rt.addTask(m.mission_id, "B", "B");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(seedKey(i, "amb")),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intent.provider_idempotency_key, "early_ja_unresolved");
  mock.dropNextResponse = true;
  await dispatcher.dispatch(intent.call_intent_id);
  const unlock = rt.tryUnlockNext({
    mission_id: m.mission_id,
    upstream_intent_id: intent.call_intent_id,
  });
  assert(!unlock.ok, "ambiguous must block");
  const v = verifyEvidencePack(rt.exportEvidencePack(m.mission_id));
  assert(v.illegal_unresolved_unlocks === 0, "illegal unlock");
}

async function scenarioDoubleStart(i: number): Promise<void> {
  const rt = new MissionRuntime();
  const key = `chaos:ds:${seedKey(i, "ds")}`;
  const input = {
    client_request_id: `a-${i}`,
    mission_idempotency_key: key,
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: { v: 1 },
  } as const;
  const a = rt.createMission(input);
  const b = rt.createMission(input);
  assert(a.mission_id === b.mission_id, "double start");

  let changedInputRejected = false;
  try {
    rt.createMission({ ...input, graph_snapshot: { v: 99 } });
  } catch (error) {
    changedInputRejected =
      (error as { code?: string }).code === "MISSION_IDEMPOTENCY_CONFLICT";
  }
  assert(changedInputRejected, "same key with changed input must reject");
}

async function scenarioDeclinedUnlock(i: number): Promise<void> {
  const rt = new MissionRuntime();
  const mock = new MockCalleAdapter();
  const dispatcher = new IntentDispatcher(rt, mock, { now: NOON });
  const m = rt.createMission({
    client_request_id: `c-${i}-dec`,
    mission_idempotency_key: `chaos:dec:${seedKey(i, "dec")}`,
    template_id: "slot-recovery",
    template_version: 1,
    graph_snapshot: { i },
  });
  const task = rt.addTask(m.mission_id, "A", "A");
  const intent = rt.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload: payload(seedKey(i, "dec")),
    consent_recorded: true,
    timezone: "Europe/Berlin",
  });
  mock.scenarioByKey.set(intent.provider_idempotency_key, "declined");
  await dispatcher.dispatch(intent.call_intent_id);
  await dispatcher.ingestTerminal(intent.call_intent_id);
  const unlock = rt.tryUnlockNext({
    mission_id: m.mission_id,
    upstream_intent_id: intent.call_intent_id,
  });
  assert(unlock.ok, "declined unlocks");
  const v = verifyEvidencePack(rt.exportEvidencePack(m.mission_id));
  assert(v.ok, v.errors.join("; "));
}

const SCENARIOS = [
  scenarioLostRecover,
  scenarioAmbiguousBlock,
  scenarioDoubleStart,
  scenarioDeclinedUnlock,
];

async function main() {
  const n = parseN();
  const started = Date.now();
  let illegal = 0;
  let failures = 0;
  for (let i = 0; i < n; i++) {
    const fn = SCENARIOS[i % SCENARIOS.length]!;
    try {
      await fn(i);
    } catch (e) {
      failures += 1;
      console.error(`seed ${i} FAIL`, e);
      if (String(e).includes("illegal")) illegal += 1;
    }
  }
  const duration_ms = Date.now() - started;
  const summary = {
    ok: failures === 0,
    live_calls: 0,
    n,
    scenarios_per_cycle: SCENARIOS.length,
    failures,
    illegal_unresolved_unlocks: illegal,
    duration_ms,
    avg_ms: duration_ms / n,
  };
  const dir = join(process.cwd(), "artifacts", "chaos");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
