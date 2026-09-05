#!/usr/bin/env node
/**
 * call.mjs — places the call. DRY RUN BY DEFAULT.
 *
 * Without --live this prints the exact request it would send and exits. A skill that
 * dials by default is a skill that dials by accident.
 *
 *   node scripts/call.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor"
 *   node scripts/call.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor" --live
 */
import { validateOffice, idempotencyKey, parseArgs, loadOffices } from './_lib.mjs';
import { validateResult } from './contract.mjs';
import { renderCard, renderFailure } from './render.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.office || !args.procedure) {
  console.error('usage: call.mjs --office <id> --procedure "<name>" [--live]');
  process.exit(2);
}

const offices = loadOffices(args, import.meta.url);
const office = offices.find((o) => o.id === args.office);
const problems = validateOffice(office);
if (problems.length) {
  console.error(`REFUSING TO DIAL: ${problems.join('; ')}`);
  process.exit(3);
}

const today = new Date(Date.now()).toISOString().slice(0, 10);

// Exactly the object the SDK takes: `phone` at the top level, no target wrapper.
// CreateGoalRunRequest is a closed object — region, locale and display name live on the
// published Goal and are rejected per run.
const request = {
  goalId: process.env.COUNTERCALL_GOAL_ID ?? '<COUNTERCALL_GOAL_ID>',
  phone: office.phone_e164,
  variables: {
    office_name: office.name,
    procedure: args.procedure,
    city: office.city,
  },
  idempotencyKey: idempotencyKey(args.office, args.procedure, today),
};

if (!args.live) {
  console.log('DRY RUN - no call placed. Add --live to dial.');
  console.log('');
  console.log(JSON.stringify(request, null, 2));
  console.log('');
  console.log(`This would ring ${office.phone_e164} (${office.name}).`);
  console.log(`Source: ${office.source_url}`);
  process.exit(0);
}

if (!process.env.CALLE_API_KEY) {
  console.error('--live requires CALLE_API_KEY.');
  process.exit(4);
}
if (!process.env.COUNTERCALL_GOAL_ID) {
  console.error('--live requires COUNTERCALL_GOAL_ID (publish a Goal in CALL-E Chat first).');
  process.exit(4);
}

const { CalleClient } = await import('@call-e/calle');
const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });

console.log(`Dialling ${office.phone_e164} ...`);
const started = Date.now();
try {
  const run = await client.goals.run(request);

  // Poll on GoalRun.id. The nested runSpec/telephone `runId` is a different identity and
  // substituting it returns 404.
  const outcome = await client.goals.waitForResult(request.goalId, run.id);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const meta = { procedure: args.procedure, runId: run.id, calledAt: run.createdAt };

  // `result` and `error` are mutually exclusive and either one is terminal.
  if (outcome.error) {
    console.log(renderFailure(outcome.error.code ?? 'unknown', office, meta));
    console.log('');
    console.log(`Failed after ${seconds}s.`);
    process.exit(5);
  }

  // The server validated against the published schema; we re-validate against the schema
  // this build was PINNED to. Those are different claims, and only the second one keeps a
  // drifted Goal from rendering a confident wrong card.
  const problems = validateResult(outcome.result);
  if (problems.length) {
    console.log(renderFailure('result_invalid', office, meta));
    console.log('');
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exit(5);
  }

  console.log(renderCard(outcome.result, office, meta));
  console.log('');
  console.log(`Answered in ${seconds}s.`);
} catch (error) {
  console.error(`${error?.constructor?.name ?? 'Error'}: ${error?.message ?? error}`);
  process.exit(1);
}
