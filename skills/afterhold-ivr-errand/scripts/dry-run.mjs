#!/usr/bin/env node
/**
 * Dry-run a mission against a LOCAL AfterHold API server running in mock mode.
 *
 * Usage:
 *   # terminal 1 (apps/typescript/afterhold-api): npm run dev   (CALLE_MOCK=1 is the default)
 *   # terminal 2:
 *   node scripts/dry-run.mjs
 *
 * Guarantees:
 *   - Only talks to a loopback server (localhost / 127.0.0.1 / [::1]).
 *   - Refuses to run unless the server's /health reports mock=true. If the server
 *     is in live mode this script exits before sending any mission.
 *   - Uses a throwaway account with a random password generated per run, and
 *     fictional 555-01xx numbers.
 *
 * No call is placed. The mock adapter walks the phase timeline and produces a
 * brief within ~20 seconds.
 */

import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.AFTERHOLD_API_BASE ?? 'http://127.0.0.1:8787';
const EMAIL = `dryrun-${randomBytes(4).toString('hex')}@example.com`;
const PASSWORD = randomBytes(16).toString('hex');
const DEST = '+12025550143'; // fictional 555-01xx number

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function requireLoopback(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('AFTERHOLD_API_BASE is not a valid URL');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!loopback || u.username || u.password) {
    throw new Error('dry-run only talks to a local server (localhost, 127.0.0.1, [::1]). Use run-mission.mjs for anything else.');
  }
  return u.origin;
}

const ORIGIN = requireLoopback(BASE);

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  const res = await fetch(`${ORIGIN}${path}`, { ...opts, headers, redirect: 'error' });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  log(`checking ${ORIGIN}/health`);
  const health = await api('/health');
  if (health.mock !== true) {
    console.error('Refusing to run: the server is not in mock mode (CALLE_MOCK=0). Start it with CALLE_MOCK=1.');
    process.exit(2);
  }

  log('registering a throwaway dry-run user');
  const tok = await api('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Dry Run' }),
  });
  const auth = { Authorization: `Bearer ${tok.access_token}` };

  log('granting consent');
  await api('/v1/auth/consent', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ version: 'v1', granted: true }),
  });

  log('allowlisting destination');
  await api('/v1/numbers', { method: 'POST', headers: auth, body: JSON.stringify({ e164: DEST, label: 'Courier hub' }) });

  log('creating draft mission');
  const mission = await api('/v1/missions', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      e164: DEST,
      display_name: 'Courier Hub',
      goal: 'Check if AWB 8821 is out for delivery today. If delayed, get the rider contact.',
      archetype: 'courier',
      region: 'US',
    }),
  });

  log('previewing (auto-renders task string)');
  await api(`/v1/missions/${mission.id}/preview`, { method: 'POST', headers: auth, body: '{}' });

  log('starting (mock: no call is placed)');
  await api(`/v1/missions/${mission.id}/start`, { method: 'POST', headers: auth, body: '{}' });

  log('polling for completion…');
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const cur = await api(`/v1/missions/${mission.id}`, { headers: auth });
    log(`  status=${cur.status}`);
    if (['completed', 'voicemail', 'failed', 'canceled', 'submission_unknown'].includes(cur.status)) {
      log('--- BRIEF ---');
      console.log(JSON.stringify(cur.brief, null, 2));
      process.exit(0);
    }
  }
  log('TIMEOUT — mission did not reach terminal state within 60s');
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
