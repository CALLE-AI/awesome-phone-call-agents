#!/usr/bin/env node

/**
 * Clinic Appointment Concierge
 *
 * Calls a clinic to book a patient appointment via the CALL-E CLI, and
 * negotiates a different time if the preferred slot isn't available.
 *
 * SAFETY MODEL
 * ------------
 * - Runs in DRY-RUN mode by default. No call is ever placed unless the
 *   caller explicitly passes --live.
 * - Even in --live mode, the destination number must appear in an
 *   allow-list (ALLOWED_RECIPIENTS env var, comma-separated E.164
 *   numbers) before any call is placed. This prevents the script from
 *   being pointed at an arbitrary/unauthorized number.
 * - Phone numbers are masked in all console output and logs.
 * - All arguments passed to the CALL-E CLI use argument-array process
 *   execution (execFile), never shell string interpolation, so there is
 *   no command-injection surface from user-supplied input.
 * - Ambiguous or failed outcomes are surfaced explicitly and the script
 *   exits with a non-zero status rather than silently succeeding.
 */

'use strict';

const { execFile } = require('node:child_process');
const readline = require('node:readline');

// ---------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    phone: null,
    patient: null,
    preferred: null,
    reason: null,
    live: false,
    yes: false, // skip interactive confirmation (still requires --live)
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--phone':
        args.phone = argv[++i];
        break;
      case '--patient':
        args.patient = argv[++i];
        break;
      case '--preferred':
        args.preferred = argv[++i];
        break;
      case '--reason':
        args.reason = argv[++i];
        break;
      case '--live':
        args.live = true;
        break;
      case '--yes':
        args.yes = true;
        break;
      default:
        throw new UsageError(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

class UsageError extends Error {}

// ---------------------------------------------------------------------
// Validation & safety helpers
// ---------------------------------------------------------------------

// Strict E.164: + followed by 8-15 digits, no other characters.
const E164_RE = /^\+[1-9]\d{7,14}$/;

function assertValidE164(phone) {
  if (typeof phone !== 'string' || !E164_RE.test(phone)) {
    throw new UsageError(
      `--phone must be a strict E.164 number (e.g. +12125550142). Got: ${maskPhone(phone)}`
    );
  }
}

function maskPhone(phone) {
  if (typeof phone !== 'string' || phone.length < 6) return '[invalid]';
  const visibleStart = phone.slice(0, 3); // e.g. "+12"
  const visibleEnd = phone.slice(-2);
  return `${visibleStart}${'*'.repeat(Math.max(phone.length - 5, 3))}${visibleEnd}`;
}

function getAllowedRecipients() {
  const raw = process.env.ALLOWED_RECIPIENTS || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertRecipientAuthorized(phone) {
  const allowed = getAllowedRecipients();
  if (allowed.length === 0) {
    throw new SafetyError(
      'No ALLOWED_RECIPIENTS configured. Refusing to place a live call. ' +
      'Set the ALLOWED_RECIPIENTS environment variable to a comma-separated ' +
      'list of E.164 numbers this script is permitted to call ' +
      '(e.g. official reserved test numbers, or numbers you have consent to call).'
    );
  }
  if (!allowed.includes(phone)) {
    throw new SafetyError(
      `Recipient ${maskPhone(phone)} is not in ALLOWED_RECIPIENTS. Refusing to call.`
    );
  }
}

class SafetyError extends Error {}

function sanitizeForLog(text, maxLen = 200) {
  if (typeof text !== 'string') return '';
  const cleaned = text.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

// ---------------------------------------------------------------------
// Interactive confirmation
// ---------------------------------------------------------------------

function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// ---------------------------------------------------------------------
// CALL-E CLI invocation (argument-array execution — no shell involved)
// ---------------------------------------------------------------------

function runCalleCommand(subcommand, argsArray) {
  return new Promise((resolve, reject) => {
    execFile(
      'calle',
      [subcommand, ...argsArray],
      { timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`calle ${subcommand} failed: ${sanitizeForLog(stderr || error.message)}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function parseJsonSafely(raw, context) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse ${context} output as JSON.`);
  }
}

// ---------------------------------------------------------------------
// Core flow
// ---------------------------------------------------------------------

function buildGoal({ patient, reason, preferred }) {
  return `Schedule a clinic appointment for patient ${patient}. ` +
    `Reason for visit: ${reason}. Preferred time: ${preferred}. ` +
    `If that exact time is not available, negotiate and accept the ` +
    `closest available alternative time.`;
}

async function planCall({ phone, patient, reason, preferred }) {
  const goal = buildGoal({ patient, reason, preferred });
  const raw = await runCalleCommand('call', [
    'plan',
    '--to-phone', phone,
    '--goal', goal,
  ]);
  return parseJsonSafely(raw, 'plan_call');
}

async function runCall(planId, confirmToken) {
  const raw = await runCalleCommand('call', [
    'run',
    '--plan-id', planId,
    '--confirm-token', confirmToken,
  ]);
  return parseJsonSafely(raw, 'run_call');
}

async function pollCallResult(runId, { maxAttempts = 6, delayMs = 5000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await runCalleCommand('call', [
      'status',
      '--run-id', runId,
    ]);
    const result = parseJsonSafely(raw, 'get_call_run');

    if (result.status && result.status !== 'IN_PROGRESS') {
      return result;
    }

    console.log(`Still in progress... (attempt ${attempt}/${maxAttempts})`);
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { status: 'TIMED_OUT', run_id: runId };
}

function summarizeOutcome(result) {
  const status = result.status || 'UNKNOWN';

  if (status === 'COMPLETED') {
    return { status, message: 'Call completed successfully.' };
  }

  if (status === 'FAILED' || status === 'TIMED_OUT') {
    return {
      status,
      message: 'The call did not complete. Retry decision required.',
      nextStep: result.next_step || null,
    };
  }

  return {
    status: 'AMBIGUOUS',
    message: `Unrecognized outcome status "${status}". Treating as ambiguous; no assumption of success is made.`,
    raw_status: sanitizeForLog(status),
  };
}

async function handleRetryDecision(outcome, planContext) {
  if (outcome.status === 'COMPLETED') return outcome;

  console.log('\n--- Retry decision required ---');
  console.log(sanitizeForLog(outcome.message));
  if (outcome.nextStep && outcome.nextStep.instruction) {
    console.log(sanitizeForLog(outcome.nextStep.instruction, 400));
  }

  const shouldRetry = await confirm('Retry the call now?');
  if (!shouldRetry) {
    console.log('Not retrying. Exiting without placing another call.');
    return outcome;
  }

  console.log('Retrying...');
  return executeLiveCall(planContext, { isRetry: true });
}

async function executeLiveCall(planContext, { isRetry = false } = {}) {
  const plan = await planCall(planContext);
  const planId = plan.plan_id;
  const confirmToken = plan.confirm_token;
  if (!planId || !confirmToken) {
    throw new Error('plan_call did not return a plan_id and confirm_token.');
  }

  const started = await runCall(planId, confirmToken);
  const runId = started.run_id;
  if (!runId) {
    throw new Error('run_call did not return a run_id.');
  }

  console.log(`Call ${isRetry ? 're-' : ''}started for ${maskPhone(planContext.phone)} (run_id: ${runId})`);

  const result = await pollCallResult(runId);
  const outcome = summarizeOutcome(result);

  console.log('\n--- Result ---');
  console.log(JSON.stringify(outcome, null, 2));

  return handleRetryDecision(outcome, planContext);
}

function printDryRun(planContext) {
  console.log('=== DRY RUN (no call will be placed) ===');
  console.log(`Recipient:        ${maskPhone(planContext.phone)}`);
  console.log(`Patient name:     ${sanitizeForLog(planContext.patient, 80)}`);
  console.log(`Reason for visit: ${sanitizeForLog(planContext.reason, 120)}`);
  console.log(`Preferred time:   ${sanitizeForLog(planContext.preferred, 80)}`);
  console.log('\nTo actually place this call, re-run with --live.');
  console.log('A live call additionally requires the destination number to be');
  console.log('present in the ALLOWED_RECIPIENTS environment variable, and will');
  console.log('ask for interactive confirmation before dialing (unless --yes is passed).');
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Usage error: ${err.message}`);
      printUsage();
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  for (const [name, value] of Object.entries({
    '--phone': args.phone,
    '--patient': args.patient,
    '--preferred': args.preferred,
    '--reason': args.reason,
  })) {
    if (!value) {
      console.error(`Missing required argument: ${name}`);
      printUsage();
      process.exitCode = 2;
      return;
    }
  }

  try {
    assertValidE164(args.phone);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
    return;
  }

  const planContext = {
    phone: args.phone,
    patient: args.patient,
    preferred: args.preferred,
    reason: args.reason,
  };

  if (!args.live) {
    printDryRun(planContext);
    return;
  }

  try {
    assertRecipientAuthorized(args.phone);
  } catch (err) {
    if (err instanceof SafetyError) {
      console.error(`Refusing to place call: ${err.message}`);
      process.exitCode = 3;
      return;
    }
    throw err;
  }

  if (!args.yes) {
    const proceed = await confirm(
      `About to place a LIVE call to ${maskPhone(args.phone)}. Continue?`
    );
    if (!proceed) {
      console.log('Cancelled by user. No call was placed.');
      process.exitCode = 1;
      return;
    }
  }

  try {
    const finalOutcome = await executeLiveCall(planContext);
    if (finalOutcome.status !== 'COMPLETED') {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Call failed: ${sanitizeForLog(err.message, 500)}`);
    process.exitCode = 1;
  }
}

function printUsage() {
  console.error(`
Clinic Appointment Concierge

Usage:
  node appointment-concierge.js --phone <E.164> --patient <name> \\
    --preferred <time> --reason <reason> [--live] [--yes]

By default the script runs in DRY-RUN mode and places no call.
Pass --live to actually place a call. Live calls additionally require
the destination number to be listed in the ALLOWED_RECIPIENTS
environment variable (comma-separated E.164 numbers).
`);
}

main().catch((err) => {
  console.error(`Unexpected error: ${sanitizeForLog(err.message, 500)}`);
  process.exitCode = 1;
});