#!/usr/bin/env node
// Standalone emergency dispatch relay skill (CALL-E).
// PREVIEW by default; --real submits ONE real outbound call (single attempt,
// no voicemail, no auto-redial) and polls until the structured result arrives.
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';

const { values } = parseArgs({
  options: {
    'case-id': { type: 'string' },
    incident: { type: 'string' },
    location: { type: 'string' },
    'unit-name': { type: 'string' },
    phone: { type: 'string' },
    'confirmed-by': { type: 'string' },
    locale: { type: 'string', default: 'hi' },
    region: { type: 'string', default: 'IN' },
    real: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || !values['case-id'] || !values.incident || !values.location || !values['unit-name'] || !values.phone || !values['confirmed-by']) {
  console.error('Usage: relay.mjs --case-id K1 --incident "..." --location "..." --unit-name "..." --phone +E164 --confirmed-by "name" [--locale hi] [--real]');
  process.exit(values.help ? 0 : 1);
}

const E164 = /^\+[1-9]\d{6,14}$/;
if (!E164.test(values.phone)) { console.error('Phone must be E.164 (+country…)'); process.exit(1); }

const RESULT_SCHEMA = JSON.parse(readFileSync(new URL('../references/result-schema.json', import.meta.url), 'utf8'));

// Redact phone-shaped text only at display boundaries, never in the call input.
// This is not a general personal-data sanitizer; keep incident details minimal.
const maskText = (text) => text.replace(
  /\+[1-9][0-9 ().-]{5,}[0-9]|(?:\([2-9][0-9]{2}\)|\b[2-9][0-9]{2})[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g,
  (phone) => `***${phone.replace(/\D/g, '').slice(-4)}`,
);
const publicJson = (value) => maskText(JSON.stringify(value, null, 2));

const task = [
  `You are Kwik Relay, the outbound dispatcher assistant for an emergency control room. A human dispatcher (${values['confirmed-by']}) has CONFIRMED the following assignment. Your job is ONLY to relay it and collect the unit's answer.`,
  `Incident: ${values.incident}.`,
  `Location: ${values.location}.`,
  `Assign to: ${values['unit-name']}.`,
  `Collect exactly two things: (1) can the unit respond to this assignment, (2) their estimated arrival time in minutes.`,
  `Hard constraints: Do NOT instruct, order, or pressure the unit to move. Do NOT create or change the dispatch decision. Do NOT discuss other cases. If the line is unclear or the answer is uncertain, return "unknown" — never guess. Keep the call under two minutes. Identify yourself as calling on behalf of the emergency control room relay.`,
].join(' ');

// Matches the SDK CreateCallInput: single recipient object, not a phone list.
const input = {
  task,
  recipient: { phone: values.phone, region: values.region, locale: values.locale, name: values['unit-name'] },
  resultSchema: RESULT_SCHEMA,
  // Single attempt, no voicemail, surface errors — per the review policy for
  // live-capable demos: no automatic redial, no silent retries.
  policy: { maxAttempts: 1, voicemail: 'do_not_leave', onNotReady: 'error' },
  metadata: { caseId: values['case-id'], confirmedBy: values['confirmed-by'], product: 'kwik-relay-skill' },
};

if (!values.real) {
  console.log('PREVIEW — no call placed. Phone-masked payload:\n');
  console.log(publicJson(input));
  process.exit(0);
}

if (!process.env.CALLE_API_KEY) { console.error('CALLE_API_KEY is required for --real'); process.exit(1); }

const { CalleClient } = await import('@call-e/calle');
const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });

// Stable case key requests provider deduplication; its retention and enforcement
// are provider-specific. Reconcile an ambiguous submission before any new intent.
const idempotencyKey = `kwik-relay-skill-${values['case-id']}`;
let call;
try {
  call = await client.calls.create(input, { idempotencyKey });
} catch {
  console.error('Submission outcome is unknown. Stop and reconcile with the provider before trying again; this script does not redial. Provider error details are omitted.');
  process.exit(3);
}

console.log(maskText(`Call submitted: ${call.id} — single attempt; cannot be recalled once submitted. Polling…`));

const TERMINAL_OK = new Set(['completed', 'complete', 'succeeded', 'success', 'done']);
const TERMINAL_BAD = new Set(['failed', 'error', 'canceled', 'cancelled', 'expired']);
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  let cur;
  try {
    cur = await client.calls.get(call.id);
  } catch {
    console.error('Polling failed. The call may still be running; reconcile the printed call id manually. No redial; provider error details are omitted.');
    process.exit(3);
  }
  const s = String(cur.status || '').toLowerCase();
  if (TERMINAL_BAD.has(s) || cur.failureCode) {
    console.error(publicJson({ failed: true, status: cur.status, failureCode: cur.failureCode, details: 'Provider error details omitted.' }));
    process.exit(2);
  }
  if (TERMINAL_OK.has(s)) {
    console.log(publicJson({
      advisory: true,
      operator_review_required: true,
      structured_result: cur.structuredResult ?? null,
      result_validation: cur.resultValidation ?? null,
    }));
    process.exit(0);
  }
}
console.error('Timed out waiting for the call to finish. The call may still be running provider-side; this script exits without redialing. Poll the call id manually.');
process.exit(3);
