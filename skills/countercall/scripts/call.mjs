#!/usr/bin/env node
/**
 * call.mjs — places the call. DRY RUN BY DEFAULT.
 *
 * Without --live this prints the exact request it would send and exits. A skill that
 * dials by default is a skill that dials by accident.
 *
 *   node scripts/call.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor"
 *   node scripts/call.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor" --live
 *
 * Two transports, same card. With COUNTERCALL_GOAL_ID set it runs a published Goal; without
 * one it runs the Calls API and sends the contract as a request-scoped schema. See
 * transport.mjs for why both exist. --transport goals|calls forces one.
 */
import { validateOffice, idempotencyKey, parseArgs, loadOffices } from './_lib.mjs';
import { validateResult } from './contract.mjs';
import { renderCard, renderFailure } from './render.mjs';
import { selectTransport, missingCredentials } from './transport.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.office || !args.procedure) {
  console.error('usage: call.mjs --office <id> --procedure "<name>" [--live] [--transport goals|calls]');
  process.exit(2);
}

const offices = loadOffices(args, import.meta.url);
const office = offices.find((o) => o.id === args.office);
const problems = validateOffice(office);
if (problems.length) {
  console.error(`REFUSING TO DIAL: ${problems.join('; ')}`);
  process.exit(3);
}

// --transport is a per-invocation override of the same variable transport.mjs reads, so
// there is exactly one selection rule rather than a flag path and an env path.
const env = args.transport ? { ...process.env, COUNTERCALL_TRANSPORT: args.transport } : process.env;

let transport;
try {
  transport = selectTransport(env);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const today = new Date(Date.now()).toISOString().slice(0, 10);
const key = idempotencyKey(args.office, args.procedure, today);
const request = transport.describe(office, args.procedure, key, env);

if (!args.live) {
  console.log(`DRY RUN - no call placed. Transport: ${transport.name}. Add --live to dial.`);
  console.log('');
  console.log(JSON.stringify(request, null, 2));
  console.log('');
  console.log(`This would ring ${office.phone_e164} (${office.name}).`);
  console.log(`Source: ${office.source_url}`);
  process.exit(0);
}

const missing = missingCredentials(transport, env);
if (missing.length) {
  console.error(`--live on the ${transport.name} transport requires ${missing.join(' and ')}.`);
  if (transport.name === 'goals') {
    console.error('Publish a Goal in CALL-E Chat first, or run --transport calls, which needs only a key.');
  }
  process.exit(4);
}

const { CalleClient } = await import('@call-e/calle');
const client = new CalleClient({ apiKey: env.CALLE_API_KEY });

// The drift guard is a precondition of dialling, not of preflight. A caller who skips
// preflight still must not reach a drifted Goal.
try {
  await transport.assertReady(client, env);
} catch (error) {
  console.error(`REFUSING TO DIAL: ${error.message}`);
  for (const d of error.drift ?? []) console.error(`  - ${d}`);
  process.exit(4);
}

console.log(`Dialling ${office.phone_e164} via the ${transport.name} transport ...`);
const started = Date.now();
try {
  const outcome = await transport.run(client, office, args.procedure, key, env);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const meta = { procedure: args.procedure, runId: outcome.runId, calledAt: outcome.calledAt };

  // `result` and `error` are mutually exclusive and either one is terminal.
  if (outcome.error) {
    console.log(renderFailure(outcome.error.code ?? 'unknown', office, meta));
    console.log('');
    console.log(`Failed after ${seconds}s.`);
    process.exit(5);
  }

  // The server validated against the schema it was given; we re-validate against the schema
  // this build was PINNED to. Those are different claims, and only the second one keeps a
  // drifted Goal — or a model that returned something plausible and wrong — from rendering
  // a confident wrong card.
  const invalid = validateResult(outcome.result);
  if (invalid.length) {
    console.log(renderFailure('result_invalid', office, meta));
    console.log('');
    for (const problem of invalid) console.log(`  - ${problem}`);
    process.exit(5);
  }

  console.log(renderCard(outcome.result, office, meta));
  console.log('');
  console.log(`Answered in ${seconds}s.`);
} catch (error) {
  console.error(`${error?.constructor?.name ?? 'Error'}: ${error?.message ?? error}`);
  process.exit(1);
}
