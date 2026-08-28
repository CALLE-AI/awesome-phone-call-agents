/**
 * Lightweight E.164 handling. CALL-E requires E.164 phone numbers
 * (e.g. +14155550100). We validate the shape and offer a best-effort
 * normaliser that prepends a region dial code when the user typed a
 * local number.
 */
import { getRegion } from './regions'

const E164 = /^\+[1-9]\d{6,14}$/

export function isE164(value: string): boolean {
  return E164.test(value.trim())
}

/** Strip everything except digits and a single leading `+`. */
export function cleanPhone(value: string): string {
  const trimmed = value.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  return (hasPlus ? '+' : '') + digits
}

export interface PhoneValidation {
  ok: boolean
  normalized: string
  message?: string
  /**
   * True when the country code was *inferred* from the selected region rather
   * than typed by the user (with a leading `+`). The UI surfaces this so the
   * assumption is confirmed, never applied silently.
   */
  assumedCountry?: boolean
  /** Name of the region whose dial code was assumed, for that confirmation. */
  assumedRegion?: string
}

/**
 * Normalise a user-entered number to E.164. An explicit `+`-prefixed number is
 * accepted only if it is valid E.164 (no guessing). A national number takes the
 * *explicitly selected* region's country code and is flagged `assumedCountry`
 * so the UI can confirm it; anything of the wrong length is rejected with a
 * message rather than force-prefixed.
 */
export function normalizePhone(raw: string, regionCode: string): PhoneValidation {
  const region = getRegion(regionCode)
  const cleaned = cleanPhone(raw)

  if (!cleaned || cleaned === '+') {
    return { ok: false, normalized: '', message: 'Enter a phone number.' }
  }

  // Explicit international number — accept only strict E.164, never repair.
  if (cleaned.startsWith('+')) {
    return isE164(cleaned)
      ? { ok: true, normalized: cleaned, assumedCountry: false }
      : { ok: false, normalized: cleaned, message: 'Enter a valid international number, e.g. +1 415 555 0100.' }
  }

  // National number — apply the selected region's dial code (an explicit user
  // choice), and reject wrong-length input instead of guessing.
  const dial = region.dial
  let v = cleaned
  if (regionCode === 'US' || regionCode === 'CA') {
    if (v.length === 11 && v.startsWith('1')) v = '+' + v
    else if (v.length === 10) v = '+1' + v
    else return { ok: false, normalized: cleaned, message: `Enter 10 digits, or the full number with a country code (${dial}…).` }
  } else {
    // Drop a single leading national trunk 0 if present, then prepend dial code.
    v = dial + v.replace(/^0/, '')
  }

  return isE164(v)
    ? { ok: true, normalized: v, assumedCountry: true, assumedRegion: region.name }
    : { ok: false, normalized: cleaned, message: `Add the country code, e.g. ${dial}…` }
}

/** Mask a phone for display/logging: +1415•••0100 */
export function maskPhone(e164: string): string {
  if (!isE164(e164)) return e164
  const head = e164.slice(0, Math.min(5, e164.length - 4))
  const tail = e164.slice(-4)
  return `${head}${'•'.repeat(Math.max(2, e164.length - head.length - 4))}${tail}`
}
