/**
 * Onboarding values the dispatcher will accept.
 * Phone CHECK is the SQL regex. Consent is a row, not a boolean.
 */

export const PHONE_E164_RE = /^\+[1-9]\d{7,14}$/
export const DEFAULT_TIMEZONE = "Asia/Kolkata"
export const CONSENT_KIND_OUTBOUND = "outbound_calls"
export const CONSENT_SOURCE = "web"
export const CONSENT_VERSION = "outbound-calls-v1"

export const CONSENT_WORDING =
  "Orma will phone {phone} at the times you choose. Calls are placed through CALL-E, recorded and transcribed, so Orma can remember what you said. You can cancel a call, pause every call, or withdraw this consent at any time in Settings."

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export const WEEKDAY_CHIPS: ReadonlyArray<{ n: number; label: string }> = [
  { n: 1, label: "M" },
  { n: 2, label: "T" },
  { n: 3, label: "W" },
  { n: 4, label: "T" },
  { n: 5, label: "F" },
  { n: 6, label: "S" },
  { n: 7, label: "S" },
]

const WEEKDAY_NAMES: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
}

const WEEKDAY_FROM_SHORT: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

export type PartOfDay = "morning" | "midday" | "evening"

export type OnboardingInput = {
  displayName: string
  phone: string
  agreed: boolean
  localTime: string
  weekdays: number[]
  timeZone: string
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, "")
}

export function isE164(raw: string): boolean {
  return PHONE_E164_RE.test(normalizePhone(raw))
}

export function shownConsentWording(phoneE164: string): string {
  return CONSENT_WORDING.replace("{phone}", phoneE164)
}

export function consentTextVersion(phoneE164: string): string {
  return `${CONSENT_VERSION}\n${shownConsentWording(phoneE164)}`
}

export function buildConsentRows(input: {
  agreed: boolean
  userId: string
  phoneE164: string
}): Array<{
  user_id: string
  kind: string
  text_version: string
  source: string
}> {
  if (!input.agreed) return []
  return [
    {
      user_id: input.userId,
      kind: CONSENT_KIND_OUTBOUND,
      text_version: consentTextVersion(input.phoneE164),
      source: CONSENT_SOURCE,
    },
  ]
}

export function partOfDayFromHour(hour: number): PartOfDay {
  if (hour < 12) return "morning"
  if (hour < 16) return "midday"
  return "evening"
}

export function normalizeLocalTime(raw: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(raw.trim())
  if (!match) return null
  const second = match[3] ?? "00"
  return `${match[1]}:${match[2]}:${second}`
}

export function normalizeWeekdays(raw: number[]): number[] | null {
  const unique = [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))]
  unique.sort((a, b) => a - b)
  if (unique.length === 0) return null
  return unique
}

export function isIanaTimeZone(name: string): boolean {
  if (!name.trim()) return false
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: name })
    return true
  } catch {
    return false
  }
}

export type PreparedOnboarding = {
  displayName: string
  phoneE164: string
  agreed: boolean
  localTime: string
  weekdays: number[]
  timeZone: string
  partOfDay: PartOfDay
  consentRows: ReturnType<typeof buildConsentRows>
}

export function prepareOnboarding(
  input: OnboardingInput,
  userId: string,
): PreparedOnboarding {
  const displayName = input.displayName.trim()
  if (!displayName) throw new Error("Enter the name Orma should say.")
  const phoneE164 = normalizePhone(input.phone)
  if (!isE164(phoneE164)) {
    throw new Error("Enter a phone number in international format, starting with +.")
  }
  const localTime = normalizeLocalTime(input.localTime)
  if (!localTime) throw new Error("Pick a time for the call.")
  const weekdays = normalizeWeekdays(input.weekdays)
  if (!weekdays) throw new Error("Pick at least one day.")
  const timeZone = input.timeZone.trim() || DEFAULT_TIMEZONE
  if (!isIanaTimeZone(timeZone)) throw new Error("Pick a valid time zone.")
  const hour = Number(localTime.slice(0, 2))
  return {
    displayName,
    phoneE164,
    agreed: input.agreed,
    localTime,
    weekdays,
    timeZone,
    partOfDay: partOfDayFromHour(hour),
    consentRows: buildConsentRows({
      agreed: input.agreed,
      userId,
      phoneE164,
    }),
  }
}

export function firstCallSummary(input: {
  localTime: string
  weekdays: number[]
  timeZone: string
  now?: Date
}): string {
  const time = normalizeLocalTime(input.localTime)
  const weekdays = normalizeWeekdays(input.weekdays)
  if (!time || !weekdays) return "Your first call is at the time you chose."
  const hhmm = `${time.slice(0, 2)}:${time.slice(3, 5)}`
  const hour = Number(time.slice(0, 2))
  const minute = Number(time.slice(3, 5))
  let parts: ReturnType<typeof zonedParts>
  try {
    parts = zonedParts(input.now ?? new Date(), input.timeZone || DEFAULT_TIMEZONE)
  } catch {
    return `Your first call is at ${hhmm}.`
  }
  const wanted = new Set(weekdays)
  for (let offset = 0; offset <= 7; offset += 1) {
    const weekday = ((parts.weekday - 1 + offset) % 7) + 1
    if (!wanted.has(weekday)) continue
    if (offset === 0 && hour * 60 + minute <= parts.hour * 60 + parts.minute) continue
    const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : WEEKDAY_NAMES[weekday]
    return `Your first call is ${when} at ${hhmm}.`
  }
  return `Your first call is at ${hhmm}.`
}

function zonedParts(
  at: Date,
  timeZone: string,
): {
  hour: number
  minute: number
  weekday: number
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const map: Record<string, string> = {}
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== "literal") map[part.type] = part.value
  }
  return {
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAY_FROM_SHORT[map.weekday] ?? 1,
  }
}
