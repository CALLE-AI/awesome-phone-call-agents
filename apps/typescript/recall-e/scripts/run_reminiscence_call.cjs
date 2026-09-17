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
const { execFile } = require("child_process");
const { buildCallGoal, loadResidents } = require("./build_call_goal.cjs");

// Real call transcripts are sensitive, so this must live outside public/
// and dist/ -- anything in those directories is served as a static file
// with zero authentication by both Vite's dev server and express.static.
// data/ is never statically served; it's only ever read via the
// authenticated GET /api/call-log endpoint in server.ts.
const CALL_LOG_PATH = path.join(__dirname, "..", "data", "call_log.json");


const CALLE_ENV = {
  CALLE_SOURCE: "skills_sh",
  CALLE_INTEGRATION: "skills_sh_skill",
  CALLE_INTEGRATION_VERSION: "0.1.0",
};

/**
 * Runs `calle <args>` with an argument array (never a shell string), so
 * resident data such as names, topics, or family names can never be
 * interpreted as shell metacharacters. `sensitiveValues` (e.g. a phone
 * number or the single-use confirm_token) are stripped out of any error
 * message before it's surfaced (e.g. to logs or an API response) --
 * execFile still embeds the full argument list in a failed command's
 * error message, and a value like confirm_token is a credential, so it's
 * replaced entirely rather than partially masked.
 */
function runCalleCommand(args, sensitiveValues = []) {
  return new Promise((resolve, reject) => {
    execFile(
      "calle",
      args,
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 10, env: { ...process.env, ...CALLE_ENV } },
      (err, stdout) => {
        if (err) {
          let message = err.message;
          for (const value of sensitiveValues) {
            if (value) message = message.split(value).join("[REDACTED]");
          }
          return reject(new Error(message));
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(new Error(`Failed to parse calle output as JSON: ${parseErr.message}`));
        }
      }
    );
  });
}

async function planCall(resident, goal) {
  const region = "US";
  const language = resident.language || "English";
  const args = [
    "call", "plan",
    "--to-phone", resident.phone,
    "--goal", goal,
    "--region", region,
    "--language", language,
  ];
  const result = await runCalleCommand(args, [resident.phone]);
  return JSON.parse(result.result.content[0].text);
}

async function runCall(planId, confirmToken) {
  const args = ["call", "run", "--plan-id", planId, "--confirm-token", confirmToken];
  const result = await runCalleCommand(args, [confirmToken]);
  return JSON.parse(result.result.content[0].text);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollStatus(runId, maxAttempts = 20, delayMs = 10000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const args = ["call", "status", "--run-id", runId];
    const result = await runCalleCommand(args);
    const content = JSON.parse(result.result.content[0].text);
    if (content.status === "COMPLETED" || content.status === "FAILED") {
      return content;
    }
    await delay(delayMs);
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
 * A resident may read out a phone number during the call (their own, a
 * family member's, a callback number) and CALL-E will faithfully put it
 * in the transcript/summary text. Those free-text fields aren't a single
 * known value like resident.phone, so instead of an exact match this
 * scans for phone-number-shaped runs -- 7+ digits, optionally formatted
 * with spaces, dashes, dots, or parentheses -- and masks all but the
 * last 4 digits of each one. Applied before transcript/summary are
 * printed to console or written to call_log.json, which the dashboard
 * and GET /api/call-log both surface to the UI.
 */
function maskPhoneNumbersInText(text) {
  if (!text) return text;
  return text.replace(/\+?\d[\d\-.() ]{5,}\d/g, (match) => {
    const digitCount = (match.match(/\d/g) || []).length;
    if (digitCount < 7) return match;
    const keep = 4;
    let seen = 0;
    return match.replace(/\d/g, (digit) => {
      seen++;
      return seen > digitCount - keep ? digit : "•";
    });
  });
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
  const rawTranscript = callResult.result ? callResult.result.transcript : null;
  const distressFlag = detectDistress(rawTranscript);
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
    transcript: maskPhoneNumbersInText(rawTranscript),
    summary: maskPhoneNumbersInText(callResult.result ? callResult.result.summary : null),
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
  fs.mkdirSync(path.dirname(CALL_LOG_PATH), { recursive: true });
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
  const plan = await planCall(resident, goal);

  if (!plan.ready_to_run) {
    console.error("Plan not ready to run:", plan.clarifying_questions);
    throw new Error("Call plan requires clarification before it can run");
  }

  console.log(`Running call for ${resident.name}...`);
  const run = await runCall(plan.plan_id, plan.confirm_token);

  console.log(`Polling for completion (run_id: ${run.run_id})...`);
  const finalResult = await pollStatus(run.run_id);

  const record = buildEngagementRecord(resident, finalResult);
  appendToCallLog(record);
  console.log("Saved to data/call_log.json:");
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
