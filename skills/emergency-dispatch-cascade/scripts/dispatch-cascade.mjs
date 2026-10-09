#!/usr/bin/env node
// Two-phase emergency dispatch cascade for the CALL-E "emergency-dispatch-cascade" skill.
//
// Phase 1: ring on-call technicians one at a time, in order, stop at the first
//          clear acceptance.
// Phase 2: place one confirmation call to the customer with the assigned
//          technician's name and ETA.
//
// Default mode is a written, fixture-based dry run: no network calls, no CALL-E
// account required, and the full two-phase pipeline runs automatically because
// nothing here is real.
//
// Live mode (--live --confirm-live) places real CALL-E calls and is deliberately
// NOT fully automatic: a live "yes" is advisory only. Phase 2 (the customer call)
// never runs until a human operator types CONFIRM and supplies the ETA at a
// prompt — a heuristically-detected "yes" and a completed call transport do not
// by themselves establish a booked dispatch. See references/safety.md.
//
// Usage:
//   node dispatch-cascade.mjs --job <path-to-job.json> [--live --confirm-live]

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";

const LIFE_THREATENING_KEYWORDS = [
  "gas leak", "gas smell", "smell of gas", "fire", "smoke", "carbon monoxide",
  "co alarm", "arcing", "sparking", "burning smell", "electrocut", "flooding",
  "medical emergency", "unconscious", "life-threatening", "life threatening",
];

// E.164: a leading "+", digits only, no leading zero after the "+".
const E164_RE = /^\+[1-9]\d{6,14}$/;

// Standards-reserved NANP fictional range used by this skill's own fixtures
// (+1-555-01XX). These must never be dialed for real, so live mode refuses them.
const RESERVED_FIXTURE_RE = /^\+1555\d{4}$/;

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
  const args = { live: false, confirmLive: false, job: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--live") args.live = true;
    else if (argv[i] === "--confirm-live") args.confirmLive = true;
    else if (argv[i] === "--job") args.job = argv[++i];
  }
  if (!args.job) {
    throw new Error("Usage: dispatch-cascade.mjs --job <path-to-job.json> [--live --confirm-live]");
  }
  if (args.live && !args.confirmLive) {
    throw new Error(
      "Refusing --live without --confirm-live. Pass both only after you have confirmed " +
      "every technician and customer number in the job file is a real, authorized " +
      "recipient for this run.",
    );
  }
  return args;
}

function maskPhone(phone) {
  if (typeof phone !== "string" || phone.length < 6) return "•••";
  return `${phone.slice(0, 4)}•••${phone.slice(-4)}`;
}

// Defense in depth for free-text (subprocess errors, thrown messages): mask any
// E.164-shaped substring rather than relying on every call site to remember to.
function maskPhonesInText(text) {
  if (typeof text !== "string") return text;
  return text.replace(/\+[\d ()-]{6,24}\d/g, (m) => maskPhone(m));
}

// Live transcripts can carry real, unredacted speech (addresses, other numbers
// spoken aloud, unrelated PII). The authored dry-run fixtures are not real, so
// they are safe to print in full for the demo; a live transcript is withheld
// from logs entirely rather than trusting a best-effort scrub.
function transcriptForLog(live, transcript) {
  if (!live) return transcript;
  return transcript ? "[live transcript withheld from logs — see references/safety.md]" : transcript;
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

// Every technician and the customer must be a distinct, valid E.164 destination.
// Catches typos, a technician accidentally re-used as the customer, and a
// technician re-used twice in the roster — any of which risks calling the wrong
// person or double-booking.
function validateDestinations(job) {
  const entries = [
    { label: job.job.customer_name, phone: job.job.customer_phone },
    ...job.technicians.map((t) => ({ label: t.name, phone: t.phone })),
  ];
  const seen = new Set();
  for (const { label, phone } of entries) {
    if (typeof phone !== "string" || !E164_RE.test(phone)) {
      throw new Error(`${label}'s phone is not a valid E.164 number.`);
    }
    if (seen.has(phone)) {
      throw new Error(
        `Duplicate destination ${maskPhone(phone)} — every technician and the customer ` +
        `must be a distinct number.`,
      );
    }
    seen.add(phone);
  }
  return entries;
}

function rejectFixtureNumbersInLiveMode(entries) {
  for (const { label, phone } of entries) {
    if (RESERVED_FIXTURE_RE.test(phone)) {
      throw new Error(
        `${label}'s phone ${maskPhone(phone)} is in the standards-reserved fixture range ` +
        `(+1-555-01XX) used by this skill's dry-run demo, and must never be dialed live.`,
      );
    }
  }
}

// Deliberately conservative: only a clear positive signal counts as acceptance.
// Anything else that isn't a clear decline/no-answer is reported as unreadable
// and halts the cascade for a human, per references/safety.md. In live mode
// this classification is advisory only — see the confirmation gate in main().
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
    const detail = maskPhonesInText(String(result.stderr || result.error || "").trim());
    throw new Error(`calle ${maskPhonesInText(args.join(" "))} failed: ${detail}`);
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
  console.log(JSON.stringify(step, (_key, value) => maskPhonesInText(value)));
}

// The confirmation gate for live mode: a heuristic "yes" and a COMPLETED call
// transport are signals, not a booking. Nothing is assigned, and no customer
// call is placed, until a human operator explicitly types CONFIRM and supplies
// the ETA themselves.
async function confirmAssignment(tech) {
  log({
    phase: "advisory_acceptance",
    technician: tech.name,
    note: "Live transcript suggests acceptance. This is advisory only — nobody is booked yet.",
  });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const proceed = await rl.question(
      `Type CONFIRM to book ${tech.name} and call the customer, or anything else to stop: `,
    );
    if (proceed.trim() !== "CONFIRM") return null;
    const etaRaw = await rl.question(`Confirmed ETA in minutes for ${tech.name} (leave blank if unknown): `);
    const eta = etaRaw.trim() === "" ? null : Number(etaRaw.trim());
    return { eta_minutes: Number.isFinite(eta) ? eta : null };
  } finally {
    rl.close();
  }
}

async function main() {
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

  const destinations = validateDestinations(job);
  if (args.live) rejectFixtureNumbersInLiveMode(destinations);

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
        reason: `${tech.name}'s answer was not a clear yes or no: "${transcriptForLog(args.live, result.transcript)}".`,
        action: "Cascade paused. A human must say whether this counts as accept, decline, or a callback.",
      });
      process.exit(2);
    }

    if (outcome === "accepted") {
      if (args.live) {
        const confirmed = await confirmAssignment(tech);
        if (!confirmed) {
          log({
            phase: "assignment_not_confirmed",
            technician: tech.name,
            action: "Operator did not confirm. No one is booked; a human must decide next steps.",
          });
          process.exit(4);
        }
        assigned = { ...tech, eta_minutes: confirmed.eta_minutes };
      } else {
        assigned = { ...tech, eta_minutes: DRY_RUN_OUTCOMES[tech.phone]?.eta_minutes ?? null };
      }
      log({ phase: "assigned", technician: assigned.name, eta_minutes: assigned.eta_minutes });
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
    transcript: transcriptForLog(args.live, confirmResult.transcript),
  });

  log({
    phase: "done",
    booked_technician: assigned.name,
    eta_minutes: assigned.eta_minutes,
    customer_call_completed: confirmResult.status === "COMPLETED",
    customer_confirmed: args.live ? null : confirmResult.status === "COMPLETED",
  });
}

main().catch((err) => {
  console.error(maskPhonesInText(err.message ?? String(err)));
  process.exit(1);
});
