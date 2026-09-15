/**
 * Derive the key from the authorization, not the attempt.
 * No timestamps, UUIDs, or retry counters — re-running the same
 * authorized work is a no-op by construction.
 *
 * Source: docs/build-plan.md §2.2, docs/calle-platform.md §9 gotcha 8.
 */

export function headcountKey(input: {
  eventId: string;
  rosterEntryId: string;
  waveNo: number;
  instrumentVersion: number;
}): string {
  return `hc:${input.eventId}:${input.rosterEntryId}:${input.waveNo}:${input.instrumentVersion}`;
}

export function vouchKey(input: {
  consentId: string;
  employerId: string;
  fieldSetHash: string;
  scopeVersion: number;
}): string {
  return `vo:${input.consentId}:${input.employerId}:${input.fieldSetHash}:${input.scopeVersion}`;
}
