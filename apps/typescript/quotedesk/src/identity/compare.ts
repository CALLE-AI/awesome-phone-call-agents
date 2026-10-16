// THE CORE: RequestedSpec vs QuotedSpec -> identity verdict.
//
// Rules (fail-closed):
//   verified_match       every critical field the customer specified is
//                        CONFIRMED equal by the distributor
//   wrong_configuration  at least one critical field confirmed different —
//                        a confirmed mismatch is decisive and outranks any
//                        missing field
//   unverified           any critical field unstated or merely heard_once.
//                        Unstated is NEVER a match.
//
// Fields the customer did not specify are not compared and do not block a
// verified_match.

import { CRITICAL_FIELDS, SOFT_FIELDS } from './fields.js';
import type { IdentityVerdict, QuotedSpec, RequestedSpec } from '../types.js';

export interface ComparisonResult {
  verdict: IdentityVerdict;
  mismatchedFields: string[];       // critical fields confirmed different
  unverifiedFields: string[];       // critical fields unstated / heard_once
  softMismatchedFields: string[];   // soft fields that differ (flag only)
  notes: string[];
}

export function compareSpecs(requested: RequestedSpec, quoted: QuotedSpec): ComparisonResult {
  const mismatchedFields: string[] = [];
  const unverifiedFields: string[] = [];
  const softMismatchedFields: string[] = [];
  const notes: string[] = [];

  for (const field of CRITICAL_FIELDS) {
    const want = field.requested(requested);
    if (want === undefined || want === null || want === '') continue; // not asked for

    const got = field.quoted(quoted);
    const confidence = field.confidence(quoted) ?? 'unstated';

    if (got === undefined || got === null || got === '' || confidence === 'unstated') {
      // The distributor never said it. Unstated is never a match.
      unverifiedFields.push(field.key);
      notes.push(`${field.key}: not stated by distributor`);
      continue;
    }

    const equal = field.equal(want, got);

    if (confidence === 'confirmed') {
      if (!equal) {
        mismatchedFields.push(field.key);
        notes.push(`${field.key}: requested "${want}", distributor confirmed "${got}"`);
      }
      continue;
    }

    // heard_once: mentioned but never read back. Not trustworthy either way.
    unverifiedFields.push(field.key);
    if (!equal) {
      notes.push(`${field.key}: heard once as "${got}" which differs from requested "${want}" — needs re-confirmation`);
    } else {
      notes.push(`${field.key}: heard once, never read back`);
    }
  }

  for (const field of SOFT_FIELDS) {
    const want = field.requested(requested);
    if (want === undefined || want === null || want === '') continue;
    const got = field.quoted(quoted);
    const confidence = field.confidence(quoted) ?? 'unstated';
    if (got === undefined || got === null || got === '' || confidence === 'unstated') continue;
    if (!field.equal(want, got)) {
      softMismatchedFields.push(field.key);
      notes.push(`${field.key} (soft): requested "${want}", quoted "${got}" — flagged, still quotable`);
    }
  }

  // A confirmed mismatch is decisive: the distributor positively described a
  // different machine. It outranks any number of unverified fields.
  const verdict: IdentityVerdict =
    mismatchedFields.length > 0 ? 'wrong_configuration'
    : unverifiedFields.length > 0 ? 'unverified'
    : 'verified_match';

  return { verdict, mismatchedFields, unverifiedFields, softMismatchedFields, notes };
}

/** A row may enter the customer quote only when the configuration is a
 * verified match AND both price and ETA were read back (confirmed). */
export function eligibleForQuote(result: ComparisonResult, quoted: QuotedSpec): boolean {
  return (
    result.verdict === 'verified_match' &&
    quoted.unit_price !== undefined &&
    quoted.price_confidence === 'confirmed' &&
    quoted.eta_days !== undefined &&
    quoted.eta_confidence === 'confirmed'
  );
}

export function humanReviewReason(result: ComparisonResult, quoted: QuotedSpec): string | undefined {
  if (result.verdict === 'wrong_configuration') {
    return `Distributor confirmed a different configuration (${result.mismatchedFields.join(', ')}). Excluded from customer quote.`;
  }
  if (result.verdict === 'unverified') {
    return `Configuration not fully verified on the call (${result.unverifiedFields.join(', ')}). Needs a follow-up before quoting.`;
  }
  if (quoted.price_confidence !== 'confirmed') {
    return 'Price was not read back on the call. "Forty-two five" and "forty-two fifty" are one vowel apart — re-confirm before quoting.';
  }
  if (quoted.eta_confidence !== 'confirmed') {
    return 'ETA was not read back on the call. Re-confirm before quoting.';
  }
  return undefined;
}
