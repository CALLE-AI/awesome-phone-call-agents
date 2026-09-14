#!/usr/bin/env node
// Two-phase emergency dispatch cascade for the CALL-E "emergency-dispatch-cascade" skill.
//
// Phase 1: ring on-call technicians one at a time, in order, stop at the first
//          clear acceptance.
// Phase 2: place one confirmation call to the customer with the assigned
//          technician's name and ETA.
//
// Default mode is a written, fixture-based dry run: no network calls, no CALL-E
// account required. Pass --live to route the same two phases through the
// installed `calle` CLI instead.
//
// Usage:
//   node dispatch-cascade.mjs --job <path-to-job.json> [--live]

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const LIFE_THREATENING_KEYWORDS = [
  "gas leak", "gas smell", "smell of gas", "fire", "smoke", "carbon monoxide",
  "co alarm", "arcing", "sparking", "burning smell", "electrocut", "flooding",
  "medical emergency", "unconscious", "life-threatening", "life threatening",
];

// Written fixture outcomes for the dry-run path, keyed by technician phone.
// These are authored, not recorded from a real call — see references/safety.md.
const DRY_RUN_OUTCOMES = {
  "+15550101": { status: "DECLINED", transcript: "Sorry, I'm already on a job across town, can't make it." },
  "+15550102": { status: "COMPLETED", transcript: "Yeah I can take it, I'm maybe 35 minutes out.", eta_minutes: 35 },
  "+15550103": { status: "NO_ANSWER", transcript: null },
};
const DRY_RUN_CUSTOMER_OUTCOME = {
  status: "COMPLETED",
  transcript: "Great, thank you, I'll be home.",
};

function parseArgs(argv) {
  const args = { live: false, job: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--live") args.live = true;
    else if (argv[i] === "--job") args.job = argv[++i];
  }
  if (!args.job) {
    throw new Error("Usage: dispatch-cascade.mjs --job <path-to-job.json> [--live]");
  }
  return args;
}

function maskPhone(phone) {
  if (typeof phone !== "string" || phone.length < 6) return "•••";
  return `${phone.slice(0, 4)}•••${phone.slice(-4)}`;
}

// Naive substring matching would misfire on reassurances like "no flooding risk",
// so a keyword only counts if it is not immediately preceded by a negation.
function refusalReason(description) {
  const lower = description.toLowerCase();
  for (const kw of LIFE_THREATENING_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    const before = lower.slice(Math.max(0, idx - 12), idx);
    if (/\b(no|not|without|zero)\s+[\w\s]*$/.test(before)) continue;
    return kw;
  }
  return null;
}

// Deliberately conservative: only a clear positive signal counts as acceptance.
// Anything else that isn't a clear decline/no-answer is reported as unreadable
// and halts the cascade for a human, per references/safety.md.
function classifyOutcome(status, transcript) {
  const terminalNonAnswer = new Set(["NO_ANSWER", "FAILED", "BUSY", "VOICEMAIL", "EXPIRED", "CANCELED", "CANCELLED", "DECLINED"]);
  if (terminalNonAnswer.has(status)) return "declined";
  if (status !== "COMPLETED") return "unreadable";
  const text = (transcript ?? "").toLowerCase();
  const positive = /\b(yes|yeah|sure|i can|i'll take it|on my way)\b/.test(text);
  const negative = /\b(no|can't|cannot|not able|sorry)\b/.test(text);
  if (positive && !negative) return "accepted";
  if (negative && !positive) return "declined";
  return "unreadable";
}

function runCalleCommand(args) {
  const result = spawnSync("calle", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      CALLE_SOURCE: "skills_sh",
      CALLE_INTEGRATION: "skills_sh_skill",
      CALLE_INTEGRATION_VERSION: "0.1.0",
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`calle ${args.join(" ")} failed: ${result.stderr || result.error}`);
  }
  return JSON.parse(result.stdout);
}

function placeLiveCall(toPhone, goal) {
  const started = runCalleCommand(["call", "start", "--to-phone", toPhone, "--goal", goal, "--json"]);
  const status = started.status_result?.structuredContent ?? started.result?.structuredContent ?? {};
  return { status: status.status ?? "UNKNOWN", transcript: status.transcript ?? status.summary ?? null, raw: started };
}

function placeDryRunCall(outcome) {
  return { status: outcome.status, transcript: outcome.transcript, raw: outcome };
}

function log(step) {
  console.log(JSON.stringify(step));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const job = JSON.parse(fs.readFileSync(args.job, "utf8"));

  const blocked = refusalReason(job.job.description);
  if (blocked) {
    log({
      phase: "refusal",
      reason: `Job description mentions "${blocked}", which may be life-threatening.`,
      action: "Refusing to dispatch. Tell the caller to contact 911 or local emergency services.",
    });
    process.exit(1);
  }

  log({ phase: "start", mode: args.live ? "live" : "dry-run", job: job.job.description, address: job.job.address });

  let assigned = null;
  for (const tech of job.technicians) {
    const goal = `Ask ${tech.name} if they can take an urgent job now: ${job.job.description}, at ${job.job.address}. ` +
      `Confirm yes or no, and if yes, their ETA in minutes.`;

    const result = args.live
      ? placeLiveCall(tech.phone, goal)
      : placeDryRunCall(DRY_RUN_OUTCOMES[tech.phone] ?? { status: "NO_ANSWER", transcript: null });

    const outcome = classifyOutcome(result.status, result.transcript);
    log({ phase: "technician_call", technician: tech.name, phone: maskPhone(tech.phone), status: result.status, outcome });

    if (outcome === "unreadable") {
      log({
        phase: "halt",
        reason: `${tech.name}'s answer was not a clear yes or no: "${result.transcript}".`,
        action: "Cascade paused. A human must say whether this counts as accept, decline, or a callback.",
      });
      process.exit(2);
    }

    if (outcome === "accepted") {
      assigned = { ...tech, eta_minutes: DRY_RUN_OUTCOMES[tech.phone]?.eta_minutes ?? result.raw?.eta_minutes ?? null };
      log({ phase: "assigned", technician: tech.name, eta_minutes: assigned.eta_minutes });
      break;
    }
    // declined: fall through to the next technician
  }

  if (!assigned) {
    log({ phase: "exhausted", action: "No technician accepted. A human must decide next steps." });
    process.exit(3);
  }

  const confirmGoal = `Tell ${job.job.customer_name} that ${assigned.name} is on the way for: ${job.job.description}, ` +
    `ETA about ${assigned.eta_minutes ?? "unknown"} minutes. Confirm they will be home.`;

  const confirmResult = args.live
    ? placeLiveCall(job.job.customer_phone, confirmGoal)
    : placeDryRunCall(DRY_RUN_CUSTOMER_OUTCOME);

  log({
    phase: "customer_confirmation",
    customer: job.job.customer_name,
    phone: maskPhone(job.job.customer_phone),
    status: confirmResult.status,
    transcript: confirmResult.transcript,
  });

  log({
    phase: "done",
    booked_technician: assigned.name,
    eta_minutes: assigned.eta_minutes,
    customer_confirmed: confirmResult.status === "COMPLETED",
  });
}

main();
