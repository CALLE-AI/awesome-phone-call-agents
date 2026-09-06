#!/usr/bin/env node
/**
 * preflight.mjs — everything that must be true BEFORE a phone rings.
 * Places no call. Spends nothing. Safe to run in CI.
 *
 *   node scripts/preflight.mjs --office imigrasi-jaksel --procedure "perpanjangan paspor"
 */
import {
  validateOffice, diffContract, idempotencyKey, parseArgs, publishedRunSpec, loadOffices,
} from './_lib.mjs';
import { CONTRACT, contractFields, resultSchemaJSON } from './contract.mjs';
import { selectTransport } from './transport.mjs';

const PINNED = { version: CONTRACT.version, result_fields: contractFields() };

const args = parseArgs(process.argv.slice(2));
if (!args.office || !args.procedure) {
  console.error('usage: preflight.mjs --office <id> --procedure "<name>"');
  process.exit(2);
}

const offices = loadOffices(args, import.meta.url);
const office = offices.find((o) => o.id === args.office);
const problems = validateOffice(office);

console.log('CounterCall preflight');
console.log('---------------------');
console.log(`  office             ${args.office}`);
console.log(`  procedure          ${args.procedure}`);
console.log(`  phone              ${office?.phone_e164 ?? '(none)'}`);

if (problems.length) {
  console.log(`  E.164              FAIL - ${problems.join('; ')}`);
  console.log('');
  console.log('REFUSING TO DIAL. Numbers must match ^\\+[1-9]\\d{7,14}$ and come from the');
  console.log("office's own published page. Never guess a country code.");
  process.exit(3);
}
console.log('  E.164              ok');
console.log(`  source             ${office.source_url} (checked ${office.source_checked})`);

const transport = selectTransport();
console.log(`  transport          ${transport.name}`);

/*
 * Contract check, per transport.
 *
 * On `calls` there is nothing to fetch: the schema is generated from CONTRACT and sent with
 * the request, so what the server validates and what `validateResult` enforces come from one
 * source and cannot disagree. The check that matters is that the emitted schema is
 * well-formed and covers every pinned field — a silently truncated schema would let CALL-E
 * return a partial object the card would then render.
 */
if (transport.name === 'calls') {
  const schema = resultSchemaJSON();
  const emitted = Object.keys(schema.properties);
  const missing = contractFields().filter((f) => !emitted.includes(f));
  const unrequired = CONTRACT.required.filter((f) => !schema.required.includes(f));

  if (missing.length || unrequired.length || schema.additionalProperties !== false) {
    console.log('  contract           EMITTED SCHEMA IS WRONG');
    for (const f of missing) console.log(`                     - not emitted: ${f}`);
    for (const f of unrequired) console.log(`                     - not required: ${f}`);
    if (schema.additionalProperties !== false)
      console.log('                     - additionalProperties is not false');
    console.log('');
    console.log('REFUSING TO DIAL. The request-scoped schema does not match the pinned contract.');
    process.exit(4);
  }
  console.log(`  contract           request-scoped, v${CONTRACT.version}, ${emitted.length} fields`);
  console.log('                     no published Goal needed — the schema travels with the call');
} else if (process.env.CALLE_API_KEY && process.env.COUNTERCALL_GOAL_ID) {
  const { CalleClient } = await import('@call-e/calle');
  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });

  /*
   * A Goal that exists but is not runnable is an ordinary, foreseeable state — a draft, a
   * paused Goal, a retired one — and preflight is the tool whose entire job is to say so
   * before anything dials. It used to let the SDK error escape, so `goal_not_executable`
   * arrived as an unhandled rejection and a stack trace. A tool that argues for honest,
   * terminal failure does not get to crash on the most likely one.
   *
   * 409 and 404 are told apart deliberately: 409 means the Goal is yours and not executable,
   * 404 means no Goal by that id is visible to this key at all — a different fix each time.
   */
  let goal;
  try {
    goal = await client.goals.get(process.env.COUNTERCALL_GOAL_ID);
  } catch (err) {
    const status = err?.status ?? err?.statusCode;
    console.log('  contract           CANNOT READ THE GOAL');
    console.log('');
    if (status === 409) {
      console.log(`REFUSING TO DIAL. Goal ${process.env.COUNTERCALL_GOAL_ID} exists but is not`);
      console.log('executable — it is almost certainly still a DRAFT. Publish it in CALL-E Chat,');
      console.log('then re-run this. Draft, paused and retired Goals are invisible to goals.list');
      console.log('and refuse goals.get, by design.');
    } else if (status === 404) {
      console.log(`REFUSING TO DIAL. No Goal ${process.env.COUNTERCALL_GOAL_ID} is visible to this`);
      console.log('API key. Goals are owner-scoped: check the id, and check the key belongs to the');
      console.log('same account that published it. Cross-owner reads return 404, not 403.');
    } else {
      console.log(`REFUSING TO DIAL. goals.get failed: ${status ?? '?'} ${err?.code ?? ''} ${err?.message ?? err}`);
    }
    process.exit(4);
  }

  const drift = diffContract(PINNED, publishedRunSpec(goal));
  if (drift.length) {
    console.log('  contract           DRIFT DETECTED');
    for (const d of drift) console.log(`                     - ${d}`);
    console.log('');
    console.log('REFUSING TO DIAL. The published Goal no longer matches the contract this');
    console.log('skill was written against. Re-pin the contract and re-check the rendering.');
    process.exit(4);
  }
  console.log('  contract           matches pinned v' + PINNED.version);
} else {
  console.log('  contract           skipped (set CALLE_API_KEY + COUNTERCALL_GOAL_ID to check)');
}

const today = new Date(Date.now()).toISOString().slice(0, 10);
console.log(`  idempotency key    ${idempotencyKey(args.office, args.procedure, today)}`);
console.log('');
console.log('Preflight passed. No call was placed. Add --live to scripts/call.mjs to dial.');
