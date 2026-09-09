/**
 * run_reminiscence_call.js
 *
 * Orchestrates one reminiscence call for a resident using the calle CLI:
 *   1. Build the call goal from the resident profile (build_call_goal.js)
 *   2. Plan the call (calle call plan)
 *   3. Run the call (calle call run)
 *   4. Poll status until COMPLETED
 *   5. Extract a structured engagement record: mood, topics covered, distress flag
 *   6. Append that record to call_log.json so the dashboard can pick it up
 *
 * This wraps the exact CLI flow validated during hackathon testing.
 * Requires the calle CLI to be installed and authenticated (see the
 * hackathon's CALL-E installation guide).
 *
 * Usage:
 *   node run_reminiscence_call.js res_001
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { buildCallGoal, loadResidents } = require("./build_call_goal.cjs");

const CALL_LOG_PATH = path.join(__dirname, "..", "public", "call_log.json");


const CALLE_ENV = {
  CALLE_SOURCE: "skills_sh",
  CALLE_INTEGRATION: "skills_sh_skill",
  CALLE_INTEGRATION_VERSION: "0.1.0",
};

function runCalleCommand(args) {
  const envPrefix = Object.entries(CALLE_ENV)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const command = `env ${envPrefix} calle ${args}`;
  const output = execSync(command, { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 });
  return JSON.parse(output);
}

function planCall(resident, goal) {
  const region = "US";
  const language = resident.language || "English";
  const escapedGoal = goal.replace(/"/g, '\\"');
  const args = `call plan --to-phone "${resident.phone}" --goal "${escapedGoal}" --region ${region} --language ${language}`;
  const result = runCalleCommand(args);
  const content = JSON.parse(result.result.content[0].text);
  return content;
}

function runCall(planId, confirmToken) {
  const args = `call run --plan-id "${planId}" --confirm-token "${confirmToken}"`;
  const result = runCalleCommand(args);
  const content = JSON.parse(result.result.content[0].text);
  return content;
}

function pollStatus(runId, maxAttempts = 20, delayMs = 10000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const args = `call status --run-id "${runId}"`;
    const result = runCalleCommand(args);
    const content = JSON.parse(result.result.content[0].text);
    if (content.status === "COMPLETED" || content.status === "FAILED") {
      return content;
    }
    execSync(`sleep ${delayMs / 1000}`);
  }
  throw new Error(`Call ${runId} did not complete after ${maxAttempts} polling attempts`);
}

/**
 * Distress detection is intentionally simple for the 14 day build:
 * keyword-based scanning over the transcript. Not clinically validated.
 * A real deployment would use a more careful signal, but the behavior
 * this drives (redirect, log for review, never silently ignore) is the
 * part that matters for the demo.
 */
const DISTRESS_KEYWORDS = [
  "confused", "scared", "afraid", "don't know where", "who are you",
  "help me", "i want to go home", "where am i",
];

function detectDistress(transcript) {
  if (!transcript) return false;
  const lower = transcript.toLowerCase();
  return DISTRESS_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Very lightweight mood heuristic from the outcome + transcript.
 * Real deployments would use a proper sentiment model; this keeps the
 * report populated for the demo without overclaiming clinical accuracy.
 */
function estimateMood(callResult) {
  if (!callResult.result || !callResult.result.outcome) return "unknown";
  const { task_completed, completion_confidence } = callResult.result.outcome;
  if (!task_completed) return "unknown";
  if (completion_confidence && completion_confidence.label === "high") return "positive";
  return "neutral";
}

function buildEngagementRecord(resident, callResult) {
  const transcript = callResult.result ? callResult.result.transcript : null;
  const distressFlag = detectDistress(transcript);
  const mood = distressFlag ? "flagged_for_review" : estimateMood(callResult);
  const durationSec = callResult.result && callResult.result.outcome
    ? null // CALL-E does not currently return duration in outcome; derived from activity timestamps if needed
    : null;

  return {
    residentId: resident.id,
    residentName: resident.name,
    callDate: new Date().toISOString().slice(0, 10),
    callTime: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    status: callResult.status,
    taskCompleted: callResult.result && callResult.result.outcome
      ? callResult.result.outcome.task_completed
      : false,
    mood,
    distressFlagged: distressFlag,
    transcript,
    summary: callResult.result ? callResult.result.summary : null,
  };
}

/**
 * Appends one engagement record to call_log.json (creating the file if
 * needed). This is the persistence layer the dashboard reads from, so
 * the dashboard reflects real calls instead of only sample data.
 */
function appendToCallLog(record) {
  let log = { calls: [] };
  if (fs.existsSync(CALL_LOG_PATH)) {
    try {
      log = JSON.parse(fs.readFileSync(CALL_LOG_PATH, "utf8"));
    } catch (err) {
      console.error("Warning: call_log.json was unreadable, starting a fresh log.");
    }
  }
  log.calls.push(record);
  fs.writeFileSync(CALL_LOG_PATH, JSON.stringify(log, null, 2));
}

async function runReminiscenceCall(residentId) {
  const residents = loadResidents();
  const resident = residents.find((r) => r.id === residentId);
  if (!resident) {
    throw new Error(`No resident found with id ${residentId}`);
  }

  const goal = buildCallGoal(resident);
  console.log(`Planning call for ${resident.name}...`);
  const plan = planCall(resident, goal);

  if (!plan.ready_to_run) {
    console.error("Plan not ready to run:", plan.clarifying_questions);
    throw new Error("Call plan requires clarification before it can run");
  }

  console.log(`Running call for ${resident.name}...`);
  const run = runCall(plan.plan_id, plan.confirm_token);

  console.log(`Polling for completion (run_id: ${run.run_id})...`);
  const finalResult = pollStatus(run.run_id);

  const record = buildEngagementRecord(resident, finalResult);
  appendToCallLog(record);
  console.log("Saved to call_log.json:");
  console.log(JSON.stringify(record, null, 2));
  return record;
}

if (require.main === module) {
  const residentId = process.argv[2];
  if (!residentId) {
    console.error("Usage: node run_reminiscence_call.js <resident_id>");
    process.exit(1);
  }
  runReminiscenceCall(residentId).catch((err) => {
    console.error("Call failed:", err.message);
    process.exit(1);
  });
}

module.exports = { runReminiscenceCall, detectDistress, estimateMood, buildEngagementRecord, appendToCallLog, CALL_LOG_PATH };
