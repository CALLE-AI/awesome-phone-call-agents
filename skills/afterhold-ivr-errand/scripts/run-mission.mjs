#!/usr/bin/env node
/**
 * Create + start one mission and print the brief when terminal.
 *
 * Usage (local mock server):
 *   AFTERHOLD_JWT=eyJhbGciOi... \
 *   AFTERHOLD_INPUT=examples/courier.json \
 *   node scripts/run-mission.mjs
 *
 * Usage (remote server) additionally requires:
 *   AFTERHOLD_API_BASE=https://your-host.example   # https only
 *   AFTERHOLD_ALLOW_ORIGIN=https://your-host.example   # must equal the origin: your explicit approval
 *
 * Live safety:
 *   If the server reports mock=false (it will place a REAL call), this script
 *   refuses to continue unless AFTERHOLD_CONFIRM_LIVE=1 is set for this run,
 *   and it forwards confirm_live=true only then.
 *
 * The JWT is only ever sent to the approved origin. Redirects are refused.
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';

const RAW_BASE = process.env.AFTERHOLD_API_BASE ?? 'http://127.0.0.1:8787';
const TOKEN = process.env.AFTERHOLD_JWT;
const INPUT = process.env.AFTERHOLD_INPUT;
const CONFIRM_LIVE = process.env.AFTERHOLD_CONFIRM_LIVE === '1';
const ALLOW_ORIGIN = process.env.AFTERHOLD_ALLOW_ORIGIN;

function approvedOrigin(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('AFTERHOLD_API_BASE is not a valid URL');
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('AFTERHOLD_API_BASE must be a bare origin (no credentials, path, query, or fragment)');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (loopback) return u.origin; // plain http is fine on this machine
  if (u.protocol !== 'https:') throw new Error('AFTERHOLD_API_BASE must use https unless it is localhost');
  if (ALLOW_ORIGIN !== u.origin) {
    throw new Error(`Refusing to send credentials to ${u.origin}. Set AFTERHOLD_ALLOW_ORIGIN=${u.origin} to approve it.`);
  }
  return u.origin;
}

if (!TOKEN) {
  console.error('AFTERHOLD_JWT is required');
  process.exit(1);
}

const BASE = approvedOrigin(RAW_BASE);

async function loadInput() {
  if (INPUT) {
    return JSON.parse(await readFile(INPUT, 'utf8'));
  }
  const buf = await new Promise((res) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
  });
  return JSON.parse(buf);
}

async function api(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
    ...(opts.headers ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers, redirect: 'error' });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

  const health = await fetch(`${BASE}/health`, { redirect: 'error' }).then((r) => r.json());
  const live = health.mock !== true;
  if (live && !CONFIRM_LIVE) {
    console.error(
      'This server will place a REAL phone call. Re-run with AFTERHOLD_CONFIRM_LIVE=1 to confirm this run.\n' +
        'Only call numbers whose owners have authorized the call.',
    );
    process.exit(2);
  }

  const input = await loadInput();
  // Strip example-only fields the API does not take.
  const { extract_schema: _ignored, ...create } = input;

  log(`mode: ${live ? 'LIVE (real call)' : 'mock (no call)'}`);
  log(`creating draft for ${create.archetype ?? 'general'}`);
  const mission = await api('/v1/missions', { method: 'POST', body: JSON.stringify(create) });
  log(`mission: ${mission.id}`);

  log('previewing');
  await api(`/v1/missions/${mission.id}/preview`, { method: 'POST', body: '{}' });

  log('starting');
  const started = await api(`/v1/missions/${mission.id}/start`, {
    method: 'POST',
    body: JSON.stringify(live ? { confirm_live: true } : {}),
  });
  if (started.status === 'scheduled') {
    log('mission is scheduled and will be dialed at its scheduled time (it was NOT dialed now).');
    process.exit(0);
  }

  log('polling…');
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const cur = await api(`/v1/missions/${mission.id}`);
    log(`  status=${cur.status}`);
    if (['completed', 'voicemail', 'failed', 'canceled', 'submission_unknown'].includes(cur.status)) {
      console.log('--- BRIEF ---');
      console.log(JSON.stringify(cur.brief, null, 2));
      if (cur.status === 'submission_unknown') {
        console.log('The call may have been created. Check the CALL-E dashboard before retrying.');
      }
      process.exit(0);
    }
  }
  log('TIMEOUT (the mission may still be running; poll GET /v1/missions/:id)');
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
