#!/usr/bin/env node
// Standalone emergency dispatch relay skill (CALL-E).
// PREVIEW by default; --real places one real outbound call.
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

const task = [
  `You are Kwik Relay, the outbound dispatcher assistant for an emergency control room. A human dispatcher (${values['confirmed-by']}) has CONFIRMED the following assignment. Your job is ONLY to relay it and collect the unit's answer.`,
  `Incident: ${values.incident}.`,
  `Location: ${values.location}.`,
  `Assign to: ${values['unit-name']}.`,
  `Collect exactly two things: (1) can the unit respond to this assignment, (2) their estimated arrival time in minutes.`,
  `Hard constraints: Do NOT instruct, order, or pressure the unit to move. Do NOT create or change the dispatch decision. Do NOT discuss other cases. If the line is unclear or the answer is uncertain, return "unknown" — never guess. Keep the call under two minutes. Identify yourself as calling on behalf of the emergency control room relay.`,
].join(' ');

const payload = {
  task,
  phones: [values.phone],
  region: values.region,
  locale: values.locale,
  resultSchema: RESULT_SCHEMA,
  metadata: { caseId: values['case-id'], confirmedBy: values['confirmed-by'], product: 'kwik-relay-skill' },
};

if (!values.real) {
  console.log('PREVIEW — no call placed. Exact payload:\n');
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

if (!process.env.CALLE_API_KEY) { console.error('CALLE_API_KEY is required for --real'); process.exit(1); }

const { CalleClient } = await import('@call-e/calle');
const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });
const call = await client.calls.createAndWait(payload);
console.log(JSON.stringify({
  structured_result: call?.structured_result ?? call?.structuredResult ?? null,
  completion_confidence: call?.completion_confidence ?? null,
  transcript_turns: call?.transcript_turns?.length ?? null,
}, null, 2));
