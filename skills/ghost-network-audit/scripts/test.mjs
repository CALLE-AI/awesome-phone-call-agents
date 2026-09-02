#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { maskPhone, redactDeep, isE164 } from './mask.mjs';
import { groupByOffice, applyGates, checkCallingWindow } from './gates.mjs';
import { classifyListing, buildPayload, buildTaskText, CalleClient } from './calle.mjs';
import { scoreAudit } from './adequacy.mjs';
import { startFakeServer } from './fake-calle-server.mjs';
import { runAudit } from './audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// A Tuesday at 17:00 UTC: mid-morning to early afternoon across every US zone in
// the sample file, so the calling-window gate lets the rehearsal through.
const TUESDAY_MIDDAY = new Date('2024-06-11T17:00:00Z');

async function loadSample() {
  return JSON.parse(await readFile(join(HERE, 'sample-directory.json'), 'utf8'));
}

test('masking hides enough of a number to prevent dialing it', () => {
  const masked = maskPhone('+12125550142');
  assert.ok(!masked.includes('2125550'));
  assert.ok(masked.startsWith('+1'));
  assert.ok(masked.endsWith('42'));
});

test('redactDeep masks nested numbers and strips the api key', () => {
  const out = redactDeep(
    { a: ['+12125550142'], b: { c: 'key sk-live-123 leaked' } },
    'sk-live-123',
  );
  assert.ok(!JSON.stringify(out).includes('2125550142'));
  assert.ok(JSON.stringify(out).includes('[redacted]'));
});

test('E.164 validation rejects the loose formats a directory export contains', () => {
  assert.ok(isE164('+12125550142'));
  assert.ok(!isE164('555-0155'));
  assert.ok(!isE164('(212) 555-0142'));
  assert.ok(!isE164('+0125550142'));
});

test('offices are de-duplicated so one front desk gets one call', async () => {
  const sample = await loadSample();
  const offices = groupByOffice(sample.listings);
  const riverbend = offices.find((office) => office.phone === '+12125550142');
  assert.equal(riverbend.listings.length, 3);
  assert.ok(offices.length < sample.listings.length);
});

test('gates skip crisis lines, bad numbers, and suppressed numbers', async () => {
  const sample = await loadSample();
  const offices = groupByOffice(sample.listings);
  const { skipped } = applyGates(offices, {
    suppressionList: sample.suppression_list,
    now: TUESDAY_MIDDAY,
  });
  const reasons = skipped.map((entry) => entry.reason);
  assert.ok(reasons.some((reason) => reason.startsWith('blocked_line_type:crisis')));
  assert.ok(reasons.includes('bad_number'));
  assert.ok(reasons.includes('suppressed'));
});

test('a listing without a timezone is deferred rather than dialed on a guess', async () => {
  const sample = await loadSample();
  const offices = groupByOffice(sample.listings);
  const { deferred } = applyGates(offices, { now: TUESDAY_MIDDAY });
  assert.ok(deferred.some((entry) => entry.reason === 'no_timezone'));
});

test('calling window uses office local time, not the runner local time', () => {
  const nightInNewYork = new Date('2024-06-11T04:00:00Z'); // midnight ET, 9pm PT
  const east = checkCallingWindow(
    { timezone: 'America/New_York' },
    { now: nightInNewYork },
  );
  assert.equal(east.allowed, false);
  assert.equal(east.reason, 'outside_business_hours');

  const workday = checkCallingWindow({ timezone: 'America/New_York' }, { now: TUESDAY_MIDDAY });
  assert.equal(workday.allowed, true);
});

test('weekends are outside the calling window', () => {
  const saturday = new Date('2024-06-15T17:00:00Z');
  const check = checkCallingWindow({ timezone: 'America/New_York' }, { now: saturday });
  assert.equal(check.allowed, false);
  assert.equal(check.reason, 'weekend');
});

// The core safety invariant of the whole skill.
test('unknown answers never become ghosts', () => {
  const unknowns = [
    { reached_office: 'yes', providers: [{ name: 'Dr. A', practices_here: 'unknown' }], accepts_plan: 'unknown', accepting_new_patients: 'unknown' },
    { reached_office: 'yes', providers: [{ name: 'Dr. A', practices_here: 'yes' }], accepts_plan: 'unknown', accepting_new_patients: 'unknown' },
    { reached_office: 'unknown', providers: [], accepts_plan: 'unknown', accepting_new_patients: 'unknown' },
    { reached_office: 'no', providers: [], accepts_plan: 'no', accepting_new_patients: 'no' },
  ];
  for (const result of unknowns) {
    const verdict = classifyListing(result, 'Dr. A');
    assert.notEqual(verdict.state, 'confirmed_ghost', JSON.stringify(result));
  }
});

test('voicemail is unverified even when the schema is otherwise filled in', () => {
  const verdict = classifyListing(
    { reached_office: 'no', providers: [{ name: 'Dr. A', practices_here: 'no' }], accepts_plan: 'no', accepting_new_patients: 'no' },
    'Dr. A',
  );
  assert.deepEqual(verdict, { state: 'unverified', reason: 'no_answer' });
});

test('a refusal ends as unverified, never as a finding', () => {
  const verdict = classifyListing(
    { reached_office: 'yes', declined: true, providers: [{ name: 'Dr. A', practices_here: 'no' }], accepts_plan: 'no', accepting_new_patients: 'no' },
    'Dr. A',
  );
  assert.deepEqual(verdict, { state: 'unverified', reason: 'declined' });
});

test('confirmed states require someone to have actually said so', () => {
  const base = { reached_office: 'yes', declined: false };
  assert.equal(
    classifyListing({ ...base, providers: [{ name: 'Dr. A', practices_here: 'no' }], accepts_plan: 'yes', accepting_new_patients: 'yes' }, 'Dr. A').state,
    'confirmed_ghost',
  );
  assert.equal(
    classifyListing({ ...base, providers: [{ name: 'Dr. A', practices_here: 'yes' }], accepts_plan: 'no', accepting_new_patients: 'yes' }, 'Dr. A').state,
    'confirmed_ghost',
  );
  assert.equal(
    classifyListing({ ...base, providers: [{ name: 'Dr. A', practices_here: 'yes' }], accepts_plan: 'yes', accepting_new_patients: 'no' }, 'Dr. A').state,
    'confirmed_closed_panel',
  );
  assert.equal(
    classifyListing({ ...base, providers: [{ name: 'Dr. A', practices_here: 'yes' }], accepts_plan: 'yes', accepting_new_patients: 'yes' }, 'Dr. A').state,
    'confirmed_active',
  );
});

test('a listing not named in the result is unverified, not inferred from its neighbours', () => {
  const verdict = classifyListing(
    { reached_office: 'yes', providers: [{ name: 'Dr. A', practices_here: 'yes' }], accepts_plan: 'yes', accepting_new_patients: 'yes' },
    'Dr. B',
  );
  assert.equal(verdict.state, 'unverified');
  assert.equal(verdict.reason, 'ambiguous_answer');
});

test('task text carries the disclosure, the callback number, and every clinician', () => {
  const task = buildTaskText(
    { listings: [
      { provider_name: 'Dr. A', specialty: 'Psychiatry' },
      { provider_name: 'Dr. B', specialty: 'Psychology' },
    ] },
    { auditingOrganization: 'Example Audit Co', planName: 'Example PPO', callbackNumber: '+12125550100' },
  );
  assert.match(task, /automated call from Example Audit Co/);
  assert.ok(task.includes('+12125550100'));
  assert.ok(task.includes('- Dr. A, Psychiatry'));
  assert.ok(task.includes('- Dr. B, Psychology'));
  assert.match(task, /Do not discuss any patient/);
});

test('payload refuses to build without disclosure inputs', () => {
  const { errors } = buildPayload(
    { phone: '+12125550142', office_key: 'k', listings: [{ provider_name: 'Dr. A', specialty: 'Psychiatry' }] },
    { planName: 'Example PPO', runId: 'r1' },
  );
  assert.ok(errors.length >= 2);
});

test('the same office and run produce the same idempotency key', () => {
  const office = { phone: '+12125550142', office_key: 'k', region: 'US', locale: 'en-US', listings: [{ provider_name: 'Dr. A', specialty: 'Psychiatry' }] };
  const config = { auditingOrganization: 'Example Audit Co', planName: 'Example PPO', callbackNumber: '+12125550100', runId: 'r1' };
  assert.equal(buildPayload(office, config).idempotencyKey, buildPayload(office, config).idempotencyKey);
});

test('rates are null rather than zero when nothing was confirmed', () => {
  const score = scoreAudit([
    { state: 'unverified', reason: 'no_answer' },
    { state: 'skipped', reason: 'bad_number' },
  ]);
  assert.equal(score.ghost_rate, null);
  assert.equal(score.coverage, 0);
  assert.equal(score.counts.dialable, 1);
});

test('rates use confirmed rows as the denominator, not every row', () => {
  const score = scoreAudit([
    { state: 'confirmed_ghost' },
    { state: 'confirmed_active', next_appointment_weeks: 4 },
    { state: 'unverified', reason: 'no_answer' },
    { state: 'unverified', reason: 'declined' },
    { state: 'skipped', reason: 'suppressed' },
  ]);
  assert.equal(score.counts.confirmed, 2);
  assert.equal(score.ghost_rate, 0.5);
  assert.equal(score.coverage, 0.5); // 2 confirmed of 4 dialable
  assert.equal(score.median_wait_weeks, 4);
});

test('median wait ignores active listings that gave no estimate', () => {
  const score = scoreAudit([
    { state: 'confirmed_active', next_appointment_weeks: 2 },
    { state: 'confirmed_active', next_appointment_weeks: 10 },
    { state: 'confirmed_active', next_appointment_weeks: null },
  ]);
  assert.equal(score.median_wait_weeks, 6);
  assert.equal(score.counts.active_without_stated_wait, 1);
});

test('the fake server rejects a call whose task text omits the disclosure', async () => {
  const { server, port } = await startFakeServer(0);
  try {
    const client = new CalleClient({ baseUrl: `http://127.0.0.1:${port}` });
    await assert.rejects(
      () => client.createCall(
        { task: 'Ask them about the listing.', recipients: [{ phones: ['+12125550142'] }], result_schema: {} },
        'key-1',
      ),
      /clarification before dialing/,
    );
  } finally {
    server.close();
  }
});

test('replaying an idempotency key returns the same call instead of placing another', async () => {
  const { server, port } = await startFakeServer(0);
  try {
    const client = new CalleClient({ baseUrl: `http://127.0.0.1:${port}` });
    const payload = {
      task: 'Hello, this is an automated call from Example Audit Co.',
      recipients: [{ phones: ['+12125550142'] }],
      result_schema: {},
    };
    const first = await client.createCall(payload, 'same-key');
    const second = await client.createCall(payload, 'same-key');
    assert.equal(first.id, second.id);
  } finally {
    server.close();
  }
});

test('end to end against the fake server produces a scored, masked run', async () => {
  const sample = await loadSample();
  const { server, port } = await startFakeServer(0);
  try {
    const run = await runAudit({
      listings: sample.listings,
      suppressionList: sample.suppression_list,
      planName: sample.plan_name,
      auditingOrganization: 'Example Audit Co',
      callbackNumber: '+12125550100',
      now: TUESDAY_MIDDAY,
      live: true,
      client: new CalleClient({ baseUrl: `http://127.0.0.1:${port}` }),
      sleep: async () => {},
      runId: 'test-run',
    });

    assert.equal(run.rows.length, sample.listings.length);
    assert.ok(run.score.counts.confirmed > 0);

    const serialized = JSON.stringify(run);
    for (const listing of sample.listings) {
      if (typeof listing.phone === 'string' && listing.phone.startsWith('+')) {
        assert.ok(!serialized.includes(listing.phone), `run leaked ${listing.phone}`);
      }
    }

    // Every row carries a state, and no unverified row was ever counted as evidence.
    for (const row of run.rows) {
      assert.ok(row.state, `row ${row.listing_id} has no state`);
    }
    assert.equal(
      run.score.counts.confirmed,
      run.rows.filter((row) => row.state.startsWith('confirmed_')).length,
    );
  } finally {
    server.close();
  }
});

test('preview mode places no calls and still shows what would be sent', async () => {
  const sample = await loadSample();
  const run = await runAudit({
    listings: sample.listings,
    suppressionList: sample.suppression_list,
    planName: sample.plan_name,
    auditingOrganization: 'Example Audit Co',
    callbackNumber: '+12125550100',
    now: TUESDAY_MIDDAY,
    live: false,
    runId: 'preview-run',
  });
  assert.equal(run.mode, 'preview');
  assert.ok(run.previews.length > 0);
  assert.ok(!JSON.stringify(run.previews).includes('+12125550142'));
  assert.equal(run.rows.filter((row) => row.state.startsWith('confirmed_')).length, 0);
});
