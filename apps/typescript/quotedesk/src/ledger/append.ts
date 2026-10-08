// Append-only JSONL ledger, hash-chained. Every event (rfq parsed, call
// created, result reconciled, verdict, quote drafted) appends one line:
//   hash = sha256(prev_hash + canonical entry json)
// so history cannot be silently rewritten. Verify with verifyLedger().

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LedgerEntry } from '../types.js';

const GENESIS = 'genesis';

export function appendEntry(ledgerPath: string, type: string, payload: unknown): LedgerEntry {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  const prev = lastHash(ledgerPath);
  const core = { ts: new Date().toISOString(), type, payload, prev_hash: prev };
  const hash = createHash('sha256').update(prev + JSON.stringify(core)).digest('hex');
  const entry: LedgerEntry = { ...core, hash };
  appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

export function readLedger(ledgerPath: string): LedgerEntry[] {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerEntry);
}

export function verifyLedger(ledgerPath: string): { ok: boolean; badLine?: number } {
  const entries = readLedger(ledgerPath);
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const { hash, ...core } = entries[i];
    if (core.prev_hash !== prev) return { ok: false, badLine: i + 1 };
    const expected = createHash('sha256').update(prev + JSON.stringify(core)).digest('hex');
    if (hash !== expected) return { ok: false, badLine: i + 1 };
    prev = hash;
  }
  return { ok: true };
}

function lastHash(ledgerPath: string): string {
  const entries = readLedger(ledgerPath);
  return entries.length ? entries[entries.length - 1].hash : GENESIS;
}
