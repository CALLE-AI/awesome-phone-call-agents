/**
 * One-shot proof that the real adapter uses MissionRuntime + IntentDispatcher.
 * Default invocation is dry and cannot call. The live mode is deliberately not
 * in package.json; an operator must invoke the named experiment explicitly.
 *
 * Dry:  npx tsx scripts/spike/live-runtime-verify.ts
 * Live: npx tsx scripts/spike/live-runtime-verify.ts live
 */
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LiveCalleAdapter } from "../../src/calle/live-adapter.js";
import { IntentDispatcher } from "../../src/runtime/dispatcher.js";
import { MissionRuntime } from "../../src/runtime/mission-runtime.js";
import { MissionStore } from "../../src/runtime/store.js";
import type { CanonicalCallPayload } from "../../src/runtime/types.js";
import { checkNamedLiveGate } from "./live-gate.mjs";

// Node's built-in loader keeps shell-provided values authoritative and avoids
// adding a runtime dependency solely for this operator-only experiment.
if (existsSync(".env")) process.loadEnvFile(".env");

const mode = process.argv[2] ?? "dry";
if (mode !== "live") {
  console.log(
    JSON.stringify({
      ok: true,
      mode: "dry",
      live_calls: 0,
      note: "Pass literal `live` plus every named gate variable to authorize one call.",
    }),
  );
  process.exit(0);
}

const phone = process.env.CALLE_TEST_PHONE || "";
const apiKey = process.env.CALLE_API_KEY || "";
const base = process.env.CALLE_BASE_URL || "https://api.heycall-e.com";
const gate = checkNamedLiveGate({
  experimentId: "RUNTIME_VERIFY",
  base,
  phone,
  apiKey,
});
if (!gate.ok) {
  console.log(
    JSON.stringify({
      ok: false,
      mode: "refused",
      live_calls: 0,
      gate_failures: gate.failures,
    }),
  );
  process.exit(2);
}

const lockPath = join("artifacts", "spike", "runtime-live-verify.lock.json");
if (existsSync(lockPath)) {
  throw new Error(
    "RUNTIME_VERIFY lock already exists; inspect the prior provider run before any retry",
  );
}
mkdirSync(dirname(lockPath), { recursive: true });
const lockFd = openSync(lockPath, "wx");
writeFileSync(
  lockFd,
  JSON.stringify({
    experiment: "RUNTIME_VERIFY",
    state: "dispatch_reserved",
    reserved_at: new Date().toISOString(),
  }),
);
closeSync(lockFd);

const timeZone = process.env.CALLE_LIVE_TIMEZONE!;
const payload: CanonicalCallPayload = {
  task:
    "Continuum CALL-E runtime verification. Ask whether this is a good time for a brief test, explicitly ask for confirmation, then end. Do not book or discuss medical information.",
  recipients: [
    {
      phones: [phone],
      region: process.env.CALLE_REGION || "DE",
      locale: process.env.CALLE_LOCALE || "de-DE",
    },
  ],
  metadata: {
    continuum_experiment: "RUNTIME_VERIFY",
    maximum_logical_calls: 1,
  },
  recipient_result_schema: {
    type: "object",
    required: [
      "acceptance",
      "confirmation_question_asked",
      "answer_after_question",
      "slot_matches_offered",
      "transcript_result_conflict",
    ],
    properties: {
      acceptance: {
        type: "string",
        enum: ["candidate_accepted", "declined", "unresolved"],
      },
      confirmation_question_asked: { type: "boolean" },
      answer_after_question: { type: "boolean" },
      slot_matches_offered: { type: "boolean" },
      transcript_result_conflict: { type: "boolean" },
    },
  },
};

const store = new MissionStore(
  process.env.CONTINUUM_LIVE_DB || join(".data", "runtime-live-verify.sqlite"),
);
try {
  const runtime = new MissionRuntime();
  runtime.attachStore(store);
  const adapter = new LiveCalleAdapter({
    api_key: apiKey,
    base_url: base,
    budget_remaining: Number(process.env.CALLE_LIVE_BUDGET_REMAINING),
    experiment_id: "RUNTIME_VERIFY",
  });
  const dispatcher = new IntentDispatcher(runtime, adapter, {
    timezone: timeZone,
    quiet_hours_start: Number(process.env.CALLE_LIVE_WINDOW_START),
    quiet_hours_end: Number(process.env.CALLE_LIVE_WINDOW_END),
    max_calls_per_mission: 1,
    allowlist: [phone],
  });
  const mission = runtime.createMission({
    client_request_id: "runtime-live-verify-v1",
    mission_idempotency_key: "live:RUNTIME_VERIFY:v1",
    template_id: "runtime-live-verify",
    template_version: 1,
    graph_snapshot: { maximum_logical_calls: 1 },
  });
  const task = runtime.addTask(
    mission.mission_id,
    "One allowlisted CALL-E runtime verification",
    "Allowlisted test recipient",
  );
  const intent = runtime.authorizeIntent({
    call_task_id: task.call_task_id,
    attempt_no: 1,
    payload,
    consent_recorded: true,
    timezone: timeZone,
  });
  const result = await dispatcher.dispatch(intent.call_intent_id);
  writeFileSync(
    lockPath,
    JSON.stringify(
      {
        experiment: "RUNTIME_VERIFY",
        state: result.ok ? "provider_run_known" : result.kind,
        mission_id: mission.mission_id,
        call_intent_id: intent.call_intent_id,
        provider_run_id: result.intent.provider_run_id,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ok: result.ok,
      mode: "live",
      logical_call_cap: 1,
      mission_id: mission.mission_id,
      call_intent_id: intent.call_intent_id,
      provider_run_id: result.intent.provider_run_id,
      result_kind: result.ok ? "provider_run_known" : result.kind,
      lock_path: lockPath,
    }),
  );
  process.exitCode = result.ok ? 0 : 2;
} finally {
  store.close();
}
