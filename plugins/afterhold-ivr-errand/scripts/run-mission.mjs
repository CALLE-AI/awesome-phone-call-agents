#!/usr/bin/env node
/**
 * Create + start a real (or mock) mission and print the brief when terminal.
 *
 * Usage:
 *   AFTERHOLD_API_BASE=http://localhost:8787 \
 *   AFTERHOLD_JWT=eyJhbGciOi... \
 *   AFTERHOLD_INPUT=examples/courier.json \
 *   node scripts/run-mission.mjs
 *
 * Or via stdin:
 *   echo '{...}' | AFTERHOLD_JWT=... node scripts/run-mission.mjs
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';

const BASE = process.env.AFTERHOLD_API_BASE ?? 'http://localhost:8787';
const TOKEN = process.env.AFTERHOLD_JWT;
const INPUT = process.env.AFTERHOLD_INPUT;

if (!TOKEN) {
  console.error('AFTERHOLD_JWT is required');
  process.exit(1);
}

async function loadInput() {
  if (INPUT) {
    return JSON.parse(await readFile(INPUT, 'utf8'));
  }
  const buf = await new Promise((res) => {
    let chunks = [];
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
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const input = await loadInput();
  const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

  log(`creating draft for ${input.archetype ?? 'general'} → ${input.e164}`);
  const mission = await api('/v1/missions', { method: 'POST', body: JSON.stringify(input) });
  log(`mission: ${mission.id}`);

  log('previewing');
  await api(`/v1/missions/${mission.id}/preview`, { method: 'POST', body: '{}' });

  log('starting');
  await api(`/v1/missions/${mission.id}/start`, { method: 'POST', body: '{}' });

  log('polling…');
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const cur = await api(`/v1/missions/${mission.id}`);
    log(`  status=${cur.status}`);
    if (['completed', 'voicemail', 'failed', 'canceled'].includes(cur.status)) {
      console.log('--- BRIEF ---');
      console.log(JSON.stringify(cur.brief, null, 2));
      process.exit(0);
    }
  }
  log('TIMEOUT');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
