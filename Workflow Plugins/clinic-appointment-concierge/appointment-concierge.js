#!/usr/bin/env node
/**
 * Clinic Appointment Concierge
 * A CALL-E-powered workflow plugin that calls a clinic to schedule
 * a patient appointment, negotiates the time if needed, and returns
 * a structured result.
 *
 * Usage:
 *   node appointment-concierge.js --phone "+12125550142" --patient "Ileana Mazilu" --preferred "tomorrow afternoon" --reason "check-up"
 */

const { execSync } = require("child_process");

const ENV_PREFIX =
  "CALLE_SOURCE=skills_sh CALLE_INTEGRATION=skills_sh_skill CALLE_INTEGRATION_VERSION=0.1.0";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    out[key] = args[i + 1];
  }
  return out;
}

function runCalle(cmd) {
  const fullCmd = `${ENV_PREFIX} ${cmd}`;
  const raw = execSync(fullCmd, { encoding: "utf-8", maxBuffer: 1024 * 1024 * 10 });
  return JSON.parse(raw);
}

function buildGoal({ patient, preferred, reason }) {
  return `Call the clinic to schedule a ${reason || "check-up"} appointment for patient ${patient}. Preferred time: ${preferred || "as soon as possible"}. If that time is unavailable, ask for the next available slot and confirm the date and time before ending the call. If the clinic requires additional verification or contact details that are not available, ask what information is needed and report back. If no one answers, leave a short voicemail summarizing the request.`;
}

async function main() {
  const { phone, patient, preferred, reason } = parseArgs();

  if (!phone || !patient) {
    console.error('Usage: node appointment-concierge.js --phone "+1..." --patient "Full Name" [--preferred "tomorrow afternoon"] [--reason "check-up"]');
    process.exit(1);
  }

  const goal = buildGoal({ patient, preferred, reason });

  console.log("Step 1/3 - Planning the call...");
  const plan = runCalle(
    `calle call plan --to-phone ${phone} --goal "${goal.replace(/"/g, '\\"')}"`
  );

  const planId = plan?.result?.structuredContent?.plan_id;
  const confirmToken = plan?.result?.structuredContent?.confirm_token;

  if (!planId || !confirmToken) {
    console.log("Plan not ready yet. Full response:");
    console.log(JSON.stringify(plan, null, 2));
    process.exit(1);
  }

  console.log(`Plan ready: ${planId}`);
  console.log("Step 2/3 - Placing the call...");
  const run = runCalle(
    `calle call run --plan-id ${planId} --confirm-token ${confirmToken}`
  );

  const runId =
    run?.result?.structuredContent?.next_step?.run_id ||
    run?.result?.structuredContent?.run_id;

  if (!runId) {
    console.log("Could not get run_id. Full response:");
    console.log(JSON.stringify(run, null, 2));
    process.exit(1);
  }

  console.log(`Call started: ${runId}`);
  console.log("Step 3/3 - Checking result...");

  let attempts = 0;
  let finalStatus = null;

  while (attempts < 6) {
    attempts++;
    const status = runCalle(
      `calle call status --run-id ${runId} --timezone UTC`
    );
    const events = status?.result?.structuredContent?.events || [];
    const failedEvent = events.find((e) => e.message && e.message.includes("status=FAILED"));
    const successEvent = events.find((e) => e.message && e.message.includes("status=SUCCEEDED"));

    if (failedEvent || successEvent) {
      finalStatus = failedEvent ? "FAILED" : "SUCCEEDED";
      console.log("\n=== Final Result ===");
      console.log(`Status: ${finalStatus}`);
      console.log(JSON.stringify(status?.result?.structuredContent, null, 2));
      break;
    }

    console.log(`Still in progress... (attempt ${attempts}/6)`);
    execSync("sleep 8");
  }

  if (!finalStatus) {
    console.log("Call is still processing. Run this to check later:");
    console.log(`${ENV_PREFIX} calle call status --run-id ${runId} --timezone UTC`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});