// Per-distributor reliability scorecard, computed from the append-only
// ledger. Every reconciled call appends quoted-price and promised-ETA
// history; this is the part that compounds into a business.

import { readLedger } from './append.js';
import type { QuoteRow } from '../types.js';

export interface ScorecardRow {
  distributorId: string;
  calls: number;
  answered: number;
  verifiedMatches: number;
  wrongConfigurations: number;
  unverified: number;
  avgQuotedPrice?: number;
  avgPromisedEtaDays?: number;
  verifiedRatePct: number;
  priceSamples: number;
  etaSamples: number;
}

export function buildScorecard(ledgerPath: string): ScorecardRow[] {
  const rows = new Map<string, ScorecardRow>();

  for (const entry of readLedger(ledgerPath)) {
    if (entry.type !== 'quote_row') continue;
    const q = entry.payload as QuoteRow;
    const row =
      rows.get(q.distributorId) ??
      {
        distributorId: q.distributorId,
        calls: 0,
        answered: 0,
        verifiedMatches: 0,
        wrongConfigurations: 0,
        unverified: 0,
        verifiedRatePct: 0,
        priceSamples: 0,
        etaSamples: 0,
      };
    row.calls += 1;
    if (q.quoted.answered_by === 'human') row.answered += 1;
    if (q.verdict === 'verified_match') row.verifiedMatches += 1;
    if (q.verdict === 'wrong_configuration') row.wrongConfigurations += 1;
    if (q.verdict === 'unverified') row.unverified += 1;
    if (q.quoted.unit_price !== undefined) {
      row.priceSamples += 1;
      row.avgQuotedPrice = runningAvg(row.avgQuotedPrice, row.priceSamples, q.quoted.unit_price);
    }
    if (q.quoted.eta_days !== undefined) {
      row.etaSamples += 1;
      row.avgPromisedEtaDays = runningAvg(row.avgPromisedEtaDays, row.etaSamples, q.quoted.eta_days);
    }
    row.verifiedRatePct = Math.round((row.verifiedMatches / row.calls) * 100);
    rows.set(q.distributorId, row);
  }

  return [...rows.values()].sort((a, b) => b.verifiedRatePct - a.verifiedRatePct);
}

function runningAvg(current: number | undefined, n: number, next: number): number {
  if (current === undefined) return next;
  return Math.round(((current * (n - 1) + next) / n) * 100) / 100;
}
