// src/cli.ts — dry-run verification CLI (NO network, NO CALL-E calls).
//
//   npm run demo                          run every bundled fixture, assert its expected verdict
//   npm run verify -- fixtures/B_self_correction.json --intent reschedule --intended-time 15:00
//   npm run verify -- ./my-call.json --intent confirm --intended-date 2026-09-08 --intended-time 09:00
//
// Input is a CALL-E `WebhookEvent` or bare `CallTask` JSON. The tool re-reads the
// transcript, runs parse → detect → decide, and prints the verdict. It never places a
// call — wiring `POST /v1/calls` is your CALL-E integration's job (see README, "Going live").

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decide,
  detect,
  parseTranscript,
  type BookingValue,
  type CalleCallTask,
  type CalleWebhookEvent,
  type GateInput,
  type Intent,
  type TranscriptTurn,
} from "./index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../fixtures");
const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/New_York";

interface Scenario {
  call: string;
  label: string;
  intent: Intent;
  intended: BookingValue;
  expect: "ALLOW" | "BLOCK";
}

function isWebhookEvent(v: unknown): v is CalleWebhookEvent {
  return !!v && typeof v === "object" && "data" in (v as Record<string, unknown>);
}

function loadCallTask(path: string): CalleCallTask {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return isWebhookEvent(raw) ? raw.data : (raw as CalleCallTask);
}

function flattenTranscript(task: CalleCallTask): TranscriptTurn[] {
  const attempts = task.recipients[0]?.attempts ?? [];
  const last = attempts[attempts.length - 1];
  return (last?.transcript_turns ?? []).map((t) => ({
    offset_seconds: t.offset_seconds,
    speaker: t.speaker,
    text: t.text,
  }));
}

function run(task: CalleCallTask, intent: Intent, intended: BookingValue) {
  const parsed = parseTranscript(flattenTranscript(task), {
    businessTz: intended.timezone || BUSINESS_TZ,
    callCreatedAt: task.created_at,
  });
  const ambiguity = detect({
    parsed,
    intent,
    intended_value: intended,
    original_hold_value: intended,
  });
  // This tool has no calendar. It demonstrates the claim → transcript → gate path, so it
  // supplies a slot_recheck that is "still ours" and a hold that has not expired. In
  // production you pass the real values from your own resource store.
  const input: GateInput = {
    intent,
    intended_value: intended,
    original_hold: {
      hold_id: "hold_demo",
      slot_id: "slot_demo",
      value: intended,
      expires_at: "2099-01-01T00:00:00Z",
    },
    calle: {
      status: task.status,
      task_completed: task.task_completed,
      completion_confidence: task.completion_confidence,
      structured_result: task.structured_result,
    },
    parsed,
    ambiguity,
    matched_fixtures: [],
    slot_recheck: {
      slot_id: "slot_demo",
      held_by_hold_id: "hold_demo",
      available: false,
      sandbox_ok: true,
    },
    now: task.completed_at ?? task.created_at,
  };
  return { parsed, ambiguity, decision: decide(input) };
}

function report(header: string, task: CalleCallTask, intent: Intent, intended: BookingValue) {
  const { parsed, ambiguity, decision } = run(task, intent, intended);
  const claim = `task_completed=${String(task.task_completed)} confidence=${
    task.completion_confidence?.label ?? "null"
  }`;
  const parsedValue = parsed.resolved_targets[0]
    ? `${parsed.resolved_targets[0].date} ${parsed.resolved_targets[0].time}`
    : "(none)";
  console.log(`\n${header}`);
  console.log(`  CALL-E claim   : ${claim}`);
  console.log(`  intended value : ${intended.appointment_date} ${intended.appointment_time} (${intent})`);
  console.log(`  parsed target  : ${parsedValue}  explicit_confirmation=${parsed.explicit_confirmation}`);
  console.log(`  ambiguity      : [${ambiguity.flags.join(", ") || "none"}]`);
  console.log(
    `  VERDICT        : ${decision.decision}  reason=${decision.reason_code}` +
      (decision.ghost_booking_prevented ? "  (ghost booking prevented)" : ""),
  );
  if (decision.decision === "BLOCK" && decision.repair_target) {
    console.log(
      `  repair via SMS : "${decision.repair_target.appointment_date} ${decision.repair_target.appointment_time} — reply YES to confirm"`,
    );
  }
  return decision.decision;
}

function runAll(): number {
  const scenarios = JSON.parse(
    readFileSync(join(FIXTURES, "scenarios.json"), "utf8"),
  ) as Scenario[];
  let failures = 0;
  for (const s of scenarios) {
    const verdict = report(s.label, loadCallTask(join(FIXTURES, s.call)), s.intent, s.intended);
    if (verdict !== s.expect) {
      console.log(`  !! expected ${s.expect}, got ${verdict}`);
      failures += 1;
    }
  }
  console.log(
    `\n${scenarios.length - failures}/${scenarios.length} scenarios matched their expected verdict.`,
  );
  return failures === 0 ? 0 : 1;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const wantsAll = process.argv.includes("--all");

  if (wantsAll || positional.length === 0) {
    if (!wantsAll) {
      console.log(
        "verity-verification-core — dry-run gate for CALL-E phone tasks (no calls placed)\n\n" +
          "  npm run demo                         run the bundled A / B / D scenarios\n" +
          "  npm run verify -- <call.json> --intent <book|reschedule|confirm> \\\n" +
          "                    --intended-date YYYY-MM-DD --intended-time HH:mm [--service haircut]\n",
      );
    }
    process.exit(runAll());
  }

  const intent = (arg("intent") ?? "confirm") as Intent;
  const task = loadCallTask(isAbsolute(positional[0]!) ? positional[0]! : resolve(process.cwd(), positional[0]!));
  const intended: BookingValue = {
    appointment_date: arg("intended-date") ?? new Date(task.created_at).toISOString().slice(0, 10),
    appointment_time: arg("intended-time") ?? "09:00",
    timezone: arg("timezone") ?? BUSINESS_TZ,
    service_type: arg("service") ?? "haircut",
  };
  const verdict = report(`${positional[0]}`, task, intent, intended);
  process.exit(verdict === "ALLOW" ? 0 : 2);
}

main();
