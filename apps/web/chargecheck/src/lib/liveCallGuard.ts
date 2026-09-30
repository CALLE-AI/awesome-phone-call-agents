import { Station } from "./types";

/**
 * Minimal E.164 check: a leading "+", country code digit 1-9, then 7-14
 * more digits (max 15 digits total per the E.164 spec). This is a format
 * check only — it does not confirm the number is reachable, assigned, or
 * that CALL-E can dial it; it only rejects obviously malformed input before
 * it ever reaches the provider.
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Server-side gate for live calling, enforced regardless of what the
 * client requests. Two independent checks:
 *   1. The station must be explicitly marked `liveCallAuthorized` — this
 *      is what keeps the fictional DEMO_STATIONS set from ever being
 *      dialed for real, even if a client sends one of those ids with
 *      demoMode: false.
 *   2. The station's phone number must be valid E.164.
 * Returns null when every station passes; otherwise a human-readable
 * error naming the first station that failed and why, suitable for
 * returning directly in an API error response.
 */
export function validateLiveStations(stations: Station[]): string | null {
  for (const station of stations) {
    if (!station.liveCallAuthorized) {
      return `"${station.name}" is not authorized for live calling (it's part of the fictional demo set). Use demo mode, or select a station from the US live test set.`;
    }
    if (!isValidE164(station.phone)) {
      return `"${station.name}" does not have a valid E.164 phone number on file, so a live call was refused.`;
    }
  }
  return null;
}
