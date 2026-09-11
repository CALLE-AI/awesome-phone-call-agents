/**
 * CALL-E live integration verification.
 *
 * Places one real incident call through the same code path the browser app
 * uses, then prints the structured decision CALL-E extracted from the
 * conversation. Run this before recording the demo video so you know the
 * whole loop works on your account and your number.
 *
 * Usage:
 *   node scripts/verifyLiveCall.js                        # both read from .env
 *   node scripts/verifyLiveCall.js +14155552671           # key read from .env
 *   node scripts/verifyLiveCall.js +14155552671 iams_live_...
 *
 * With no arguments it dials the rung 1 contact seeded in .env, which is the
 * same destination the web app would dial first. That makes this a rehearsal
 * of the demo rather than a separate code path.
 *
 * This spends one call credit and rings a real phone. Answer it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CalleIncidentCommander } from '../src/agents/calleService.js';
import { EscalationLadder } from '../src/agents/escalationLadder.js';
import { INCIDENT_SCENARIOS } from '../src/data/scenarios.js';

/**
 * Reads a single variable from a .env file when it is not already in the
 * environment. PowerShell has no inline `VAR=value command` form, so a file is
 * the practical way to supply these on Windows.
 */
function fromDotEnv(name) {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return '';
  const line = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
}

const env = (name) => (process.env[name] || '').trim() || fromDotEnv(name);

const phoneArg = process.argv[2] || env('CALLE_ROTA_PRIMARY_PHONE') || env('CALLE_EXAMPLE_PHONE');
const keyArg = process.argv[3] || env('CALLE_API_KEY');
// Naming the person lets CALL-E confirm who it is speaking to, which is the
// difference between an authorising `named_engineer` answer and every other
// outcome, so the rung 1 name is carried through here too.
const contactName = env('CALLE_ROTA_PRIMARY_NAME') || 'On-Call Engineer';

if (!phoneArg || !keyArg) {
  console.error(`
Usage:
  node scripts/verifyLiveCall.js                  # phone and key read from .env
  node scripts/verifyLiveCall.js <phone>          # key read from .env
  node scripts/verifyLiveCall.js <phone> <key>    # both passed explicitly

Example:
  node scripts/verifyLiveCall.js +14155552671 iams_live_abc123

Set CALLE_API_KEY and CALLE_ROTA_PRIMARY_PHONE in .env to run it with no
arguments. See .env.example for the shape.

This places a REAL phone call and spends one credit.
`);
  process.exit(1);
}

const service = new CalleIncidentCommander(keyArg);

if (!service.isLiveMode) {
  console.error('No usable API key. Put CALLE_API_KEY in .env, or pass it as the second argument.');
  process.exit(1);
}

const check = service.validatePhoneNumber(phoneArg);
if (!check.valid) {
  console.error(`Phone number rejected: ${check.error}`);
  process.exit(1);
}

const scenario = INCIDENT_SCENARIOS['fintech-race'];
const incidentId = `verify-${Date.now().toString(36)}`;
// Region and locale are intentionally left unset so they resolve from CALL-E's
// published coverage for this destination rather than being forced to en-US.
const contact = {
  id: 'primary',
  name: contactName,
  role: 'primary on-call engineer',
  phone: check.phone
};

console.log('CALL-E live verification');
console.log('------------------------');
console.log(`Destination      ${check.phone}`);
console.log(`Asking for       ${contact.name}`);
console.log(`Resolved region  ${check.region.code} (${check.region.name}), locale ${check.region.locale}, ${check.region.line} line`);
if (check.warning) console.log(`Coverage note    ${check.warning}`);
console.log(`Key prefix       ${service.apiKey.slice(0, 12)}...`);
console.log(`Incident         ${incidentId}`);
console.log(`Idempotency key  ${service.buildIdempotencyKey(incidentId, contact.id)}`);
console.log('');
console.log('Answer the phone. CALL-E will explain the incident and ask you to');
console.log('choose: deploy the hotfix, hold for review, roll back, or escalate.');
console.log('');

const ladder = new EscalationLadder({
  service,
  onEvent: (event) => {
    switch (event.type) {
      case 'rung:placed':
        console.log(`  call task created: ${event.callId}`);
        break;
      case 'rung:progress':
        console.log(`  status: ${event.snapshot.status} / attempt ${event.snapshot.attemptStatus}`);
        break;
      case 'rung:failed':
        console.log(`  failed: ${event.error}`);
        break;
      case 'rung:timeout':
        console.log('  timed out waiting for a terminal call state');
        break;
      default:
        break;
    }
  }
});

const outcome = await ladder.run({ scenario, contacts: [contact], incidentId });
const rung = outcome.rungs[0];

console.log('');
console.log('Result');
console.log('------');
console.log(`Decision           ${CalleIncidentCommander.describeDecision(outcome.decision)}`);
console.log(`Authorised         ${outcome.authorised ? 'yes' : 'no'}`);
// A call that was never placed has no answerer, and saying otherwise would
// read as though a phone rang and nobody picked it up.
const answeredLabel = rung?.outcome?.callPlaced === false
  ? 'nobody, because no call was placed'
  : CalleIncidentCommander.describeAnswerer(rung?.outcome?.answeredBy);
console.log(`Answered by        ${answeredLabel}`);
console.log(`Reason             ${outcome.reason}`);

if (rung?.snapshot) {
  const s = rung.snapshot;
  console.log(`Completion conf.   ${s.completionConfidence ? `${s.completionConfidence.score} (${s.completionConfidence.label})` : 'not reported'}`);
  console.log(`Task completed     ${s.taskCompleted}`);
  if (s.failureCode) console.log(`Failure            ${s.failureCode}: ${s.failureMessage}`);

  console.log('');
  console.log('Structured result extracted from the conversation:');
  console.log(JSON.stringify(s.structuredResult, null, 2));

  if (s.transcript?.length) {
    console.log('');
    console.log('Transcript:');
    s.transcript.forEach((t) => console.log(`  ${t.speaker}: ${t.text}`));
  }

  if (s.evidence?.length) {
    console.log('');
    console.log('Evidence:');
    s.evidence.forEach((e) => console.log(`  - ${e}`));
  }

  const { events } = await service.listCallEvents(s.callId);
  if (events.length) {
    console.log('');
    console.log('Developer events:');
    events.forEach((e) => console.log(`  ${e.created_at || ''} ${e.type}`));
  }
}

// ---------------------------------------------------------------------------
// Field coverage
//
// The point of this section is to answer one question honestly: how much of
// what the app displays during a live call actually came back from CALL-E?
// Anything marked missing is a field the API did not populate for this call.
// ---------------------------------------------------------------------------

const snap = rung?.snapshot;
const coverage = [
  ['call id', snap?.callId],
  ['call status', snap?.status],
  ['recipient status', snap?.recipientStatus],
  ['attempt status', snap?.attemptStatus],
  ['dialled number', snap?.phone],
  ['transcript turns', snap?.transcript?.length ? `${snap.transcript.length} turns` : null],
  ['structured result', snap?.structuredResult ? 'present' : null],
  ['completion confidence', snap?.completionConfidence ? `${snap.completionConfidence.score}` : null],
  ['task completed flag', snap?.taskCompleted === null || snap?.taskCompleted === undefined ? null : String(snap.taskCompleted)],
  ['evidence items', snap?.evidence?.length ? `${snap.evidence.length}` : null],
  ['call summary', snap?.summary],
  ['created at', snap?.createdAt],
  ['completed at', snap?.completedAt]
];

console.log('');
console.log('API field coverage');
console.log('------------------');
let populated = 0;
for (const [label, value] of coverage) {
  const ok = value !== null && value !== undefined && value !== '';
  if (ok) populated++;
  console.log(`  ${ok ? '[x]' : '[ ]'} ${label.padEnd(22)} ${ok ? String(value).slice(0, 40) : 'not returned'}`);
}
console.log('');
console.log(`  ${populated} of ${coverage.length} fields returned by CALL-E for this call.`);

console.log('');
if (!snap?.structuredResult) {
  console.log('No structured result came back. That usually means nobody answered,');
  console.log('the conversation ended before a decision was stated, or the result');
  console.log('failed schema validation. The app treats all three the same way: it');
  console.log('refuses to deploy and escalates to the next rung.');
  process.exit(2);
}

console.log('Live integration verified. The structured decision above is what');
console.log('gates the deployment in the web app.');
