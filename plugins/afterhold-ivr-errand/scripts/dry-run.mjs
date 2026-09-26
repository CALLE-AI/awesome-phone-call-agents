#!/usr/bin/env node
/**
 * Dry-run a mission against a locally-running AfterHold API server with CALLE_MOCK=1.
 *
 * Usage:
 *   AFTERHOLD_API_BASE=http://localhost:8787 \
 *   AFTERHOLD_EMAIL=demo@afterhold.io \
 *   AFTERHOLD_PASSWORD=demo12345 \
 *   node scripts/dry-run.mjs
 *
 * No live CALL-E call is made. The mock adapter walks the phase timeline and produces a
 * believable brief within ~20 seconds.
 */

import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.AFTERHOLD_API_BASE ?? 'http://localhost:8787';
const EMAIL = process.env.AFTERHOLD_EMAIL ?? 'demo@afterhold.io';
const PASSWORD = process.env.AFTERHOLD_PASSWORD ?? 'demo12345';

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function loginOrRegister() {
  try {
    return await api('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
  } catch {
    return await api('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Dry Run' }),
    });
  }
}

async function main() {
  log(`logging in to ${BASE}`);
  const tok = await loginOrRegister();
  const auth = { Authorization: `Bearer ${tok.access_token}` };

  log('granting consent');
  await api('/v1/auth/consent', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ version: 'v1', granted: true }),
  });

  log('allowlisting destination');
  try {
    await api('/v1/numbers', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ e164: '+914400001122', label: 'BlueDart' }),
    });
  } catch {
    /* may already exist */
  }

  log('creating draft mission');
  const mission = await api('/v1/missions', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      e164: '+914400001122',
      display_name: 'BlueDart Chennai Hub',
      goal: 'Check if AWB 8821 is out for delivery today. If delayed, get the rider contact.',
      archetype: 'courier',
    }),
  });

  log('previewing (auto-renders task string)');
  await api(`/v1/missions/${mission.id}/preview`, { method: 'POST', headers: auth, body: '{}' });

  log('starting');
  await api(`/v1/missions/${mission.id}/start`, { method: 'POST', headers: auth, body: '{}' });

  log('polling for completion…');
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const cur = await api(`/v1/missions/${mission.id}`, { headers: auth });
    log(`  status=${cur.status}`);
    if (['completed', 'voicemail', 'failed', 'canceled'].includes(cur.status)) {
      log('--- BRIEF ---');
      console.log(JSON.stringify(cur.brief, null, 2));
      process.exit(0);
    }
  }
  log('TIMEOUT — mission did not reach terminal state within 60s');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
