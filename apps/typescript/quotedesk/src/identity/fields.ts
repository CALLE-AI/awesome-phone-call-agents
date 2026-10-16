// Critical vs soft field definitions for configuration identity resolution.
//
// A critical mismatch means the distributor quoted a DIFFERENT machine —
// a wrong answer wearing a cheaper price tag. A soft mismatch is worth a
// flag but the quote is still for the same machine.

import type { Confidence, QuotedSpec, RequestedSpec } from '../types.js';

export interface FieldDef {
  key: string;                                        // display name
  requested: (r: RequestedSpec) => string | number | undefined;
  quoted: (q: QuotedSpec) => string | number | undefined;
  confidence: (q: QuotedSpec) => Confidence | undefined;
  equal: (a: string | number, b: string | number) => boolean;
}

/** Normalize free-text hardware names for comparison: lowercase, strip
 * vendor noise words, collapse whitespace. "NVIDIA GeForce RTX 5080 Laptop
 * GPU" and "rtx 5080" compare equal; "RTX 5070" does not. */
export function normalizeName(value: string): string {
  const noise = /\b(nvidia|geforce|laptop gpu|laptop|gpu|graphics|intel|amd|processor|cpu)\b/g;
  return value
    .toLowerCase()
    .replace(noise, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const nameEqual = (a: string | number, b: string | number) =>
  normalizeName(String(a)) === normalizeName(String(b));

/** Family names tolerate extra tokens on the distributor side (brand,
 * "gaming laptop") but every requested token must be present: quoting
 * "Acer Predator Helios 16 AI" matches a request for "Predator Helios 16
 * AI", while "Predator Helios 16" (a different family) does not. */
const familyEqual = (want: string | number, got: string | number) => {
  const wantTokens = normalizeName(String(want)).split(' ');
  const gotTokens = new Set(normalizeName(String(got)).split(' '));
  return wantTokens.every((t) => gotTokens.has(t));
};

const numberEqual = (a: string | number, b: string | number) =>
  Number(a) === Number(b);

/** Critical fields: a confirmed mismatch on any of these is a
 * wrong_configuration verdict. */
export const CRITICAL_FIELDS: FieldDef[] = [
  {
    key: 'family',
    requested: (r) => r.family,
    quoted: (q) => q.family,
    confidence: (q) => q.family_confidence,
    equal: familyEqual,
  },
  {
    key: 'gpu',
    requested: (r) => r.gpu,
    quoted: (q) => q.gpu,
    confidence: (q) => q.gpu_confidence,
    equal: nameEqual,
  },
  {
    key: 'ramGb',
    requested: (r) => r.ramGb,
    quoted: (q) => q.ram_gb,
    confidence: (q) => q.ram_confidence,
    equal: numberEqual,
  },
  {
    key: 'storageGb',
    requested: (r) => r.storageGb,
    quoted: (q) => q.storage_gb,
    confidence: (q) => q.storage_confidence,
    equal: numberEqual,
  },
  {
    key: 'cpu',
    requested: (r) => r.cpu,
    quoted: (q) => q.cpu,
    confidence: (q) => q.cpu_confidence,
    equal: nameEqual,
  },
];

/** Soft fields: mismatch is flagged, row remains quotable. */
export const SOFT_FIELDS: FieldDef[] = [
  {
    key: 'panel',
    requested: (r) => r.panel,
    quoted: (q) => q.panel,
    confidence: (q) => q.panel_confidence,
    equal: nameEqual,
  },
];
