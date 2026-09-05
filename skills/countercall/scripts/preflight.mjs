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
import { CONTRACT, contractFields } from './contract.mjs';

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

// Contract check. Offline unless a key is present — preflight must never require credentials.
if (process.env.CALLE_API_KEY && process.env.COUNTERCALL_GOAL_ID) {
  const { CalleClient } = await import('@call-e/calle');
  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });
  const goal = await client.goals.get(process.env.COUNTERCALL_GOAL_ID);
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
