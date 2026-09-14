/**
 * Regions and languages supported by CALL-E, mirrored from the CALL-E
 * integrations repo's "Supported Regions and Languages" matrix. We only offer
 * language options CALL-E actually supports for a region, so the create call
 * never comes back `unsupported_language`. `dial` is the E.164 country prefix.
 *
 * Exception: Nigeria isn't in CALL-E's published matrix, but live calls to
 * `+234` destination numbers succeed in practice. So we list Nigeria for its
 * dial code + currency, and send CALL-E a supported English region/locale via
 * `calleRegion` (the number itself is the Nigerian destination). See FEEDBACK
 * #6 — we've asked CALL-E to add NG/en-NG officially.
 *
 * Source: github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages
 */
export interface Region {
  code: string
  name: string
  flag: string
  dial: string
  defaultLocale: string
  /** ISO 4217 currency the businesses in this region quote in. */
  currency: string
  /**
   * Region code actually sent to CALL-E when it differs from `code` — used for
   * regions CALL-E can dial but hasn't listed (Nigeria). The `phones` number is
   * still the real destination; only the region/locale metadata is substituted.
   */
  calleRegion?: string
  /** BCP-47 locales CALL-E supports for this region. */
  locales: { code: string; label: string }[]
}

const EN = (code: string): { code: string; label: string } => ({ code, label: 'English' })

export const REGIONS: Region[] = [
  // English-only regions.
  { code: 'US', name: 'United States', flag: '🇺🇸', dial: '+1', defaultLocale: 'en-US', currency: 'USD', locales: [EN('en-US')] },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', dial: '+1', defaultLocale: 'en-CA', currency: 'CAD', locales: [EN('en-CA')] },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dial: '+44', defaultLocale: 'en-GB', currency: 'GBP', locales: [EN('en-GB')] },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', dial: '+61', defaultLocale: 'en-AU', currency: 'AUD', locales: [EN('en-AU')] },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', dial: '+65', defaultLocale: 'en-SG', currency: 'SGD', locales: [EN('en-SG')] },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', dial: '+60', defaultLocale: 'en-MY', currency: 'MYR', locales: [EN('en-MY')] },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', dial: '+62', defaultLocale: 'en-ID', currency: 'IDR', locales: [EN('en-ID')] },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', dial: '+63', defaultLocale: 'en-PH', currency: 'PHP', locales: [EN('en-PH')] },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', dial: '+254', defaultLocale: 'en-KE', currency: 'KES', locales: [EN('en-KE')] },
  // Nigeria: dials via CALL-E (+234 confirmed working) but is not in CALL-E's
  // published matrix, so it's routed with a supported English region/locale.
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', dial: '+234', defaultLocale: 'en-US', currency: 'NGN', calleRegion: 'US', locales: [EN('en-US')] },

  // Multilingual regions (English plus a local language).
  { code: 'IN', name: 'India', flag: '🇮🇳', dial: '+91', defaultLocale: 'en-IN', currency: 'INR', locales: [EN('en-IN'), { code: 'hi-IN', label: 'Hindi' }] },
  { code: 'AE', name: 'UAE', flag: '🇦🇪', dial: '+971', defaultLocale: 'en-AE', currency: 'AED', locales: [EN('en-AE'), { code: 'ar-AE', label: 'Arabic' }] },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', dial: '+49', defaultLocale: 'de-DE', currency: 'EUR', locales: [{ code: 'de-DE', label: 'German' }, EN('en-DE')] },

  // Native-language regions.
  { code: 'FR', name: 'France', flag: '🇫🇷', dial: '+33', defaultLocale: 'fr-FR', currency: 'EUR', locales: [{ code: 'fr-FR', label: 'French' }] },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', dial: '+52', defaultLocale: 'es-MX', currency: 'MXN', locales: [{ code: 'es-MX', label: 'Spanish' }] },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', dial: '+55', defaultLocale: 'pt-BR', currency: 'BRL', locales: [{ code: 'pt-BR', label: 'Portuguese' }] },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', dial: '+81', defaultLocale: 'ja-JP', currency: 'JPY', locales: [{ code: 'ja-JP', label: 'Japanese' }] },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', dial: '+84', defaultLocale: 'vi-VN', currency: 'VND', locales: [{ code: 'vi-VN', label: 'Vietnamese' }] },
]

export const REGIONS_BY_CODE: Record<string, Region> = Object.fromEntries(
  REGIONS.map((r) => [r.code, r]),
)

export function getRegion(code: string): Region {
  return REGIONS_BY_CODE[code] ?? REGIONS[0]
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  hi: 'Hindi',
  ar: 'Arabic',
  vi: 'Vietnamese',
  pt: 'Portuguese',
}

/** Human language name for a BCP-47 locale (e.g. "es-MX" → "Spanish"). */
export function languageLabel(locale: string | null | undefined): string {
  if (!locale) return 'English'
  return LANGUAGE_NAMES[locale.split('-')[0].toLowerCase()] ?? 'English'
}

export function isEnglishLocale(locale: string | null | undefined): boolean {
  return !locale || locale.split('-')[0].toLowerCase() === 'en'
}

/** Distinct non-English languages among a set of locales, in first-seen order. */
export function nonEnglishLanguages(locales: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const loc of locales) {
    if (isEnglishLocale(loc)) continue
    const label = languageLabel(loc)
    if (!out.includes(label)) out.push(label)
  }
  return out
}

/** Spoken currency name used in the agent directive, e.g. "EUR" → "euros". */
const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US dollars',
  CAD: 'Canadian dollars',
  GBP: 'British pounds',
  AUD: 'Australian dollars',
  SGD: 'Singapore dollars',
  MYR: 'Malaysian ringgit',
  IDR: 'Indonesian rupiah',
  PHP: 'Philippine pesos',
  KES: 'Kenyan shillings',
  NGN: 'Nigerian naira',
  INR: 'Indian rupees',
  AED: 'UAE dirhams',
  EUR: 'euros',
  MXN: 'Mexican pesos',
  BRL: 'Brazilian reais',
  JPY: 'Japanese yen',
  VND: 'Vietnamese đồng',
}

/** ISO 4217 currency a region's businesses quote in (default USD). */
export function regionCurrency(code: string | null | undefined): string {
  if (!code) return 'USD'
  return REGIONS_BY_CODE[code]?.currency ?? 'USD'
}

/**
 * Region code to send to CALL-E for a display region. For most regions this is
 * the code itself; for regions CALL-E can dial but hasn't listed (Nigeria) it
 * substitutes a supported region so create-validation passes. The destination
 * phone number is unchanged — only the region metadata is swapped.
 */
export function calleRegionCode(code: string | null | undefined): string {
  if (!code) return 'US'
  const r = REGIONS_BY_CODE[code]
  return r?.calleRegion ?? code
}

/** Human/spoken name for a currency code, for the task directive. */
export function currencyName(currency: string): string {
  return CURRENCY_NAMES[currency] ?? currency
}

/**
 * The single currency shared by a set of regions, or null when they disagree
 * (a mixed-currency batch) or none are given. Callers treat null as "use the
 * default, or describe amounts per-business".
 */
export function currencyForRegions(codes: (string | null | undefined)[]): string | null {
  const set = new Set<string>()
  for (const c of codes) if (c) set.add(regionCurrency(c))
  return set.size === 1 ? [...set][0] : null
}

/**
 * Currency inferred from an E.164 number's country calling code, when it maps
 * to exactly one currency. Ambiguous codes (e.g. +1 → USD *and* CAD) return
 * null so the region selector decides. This makes typing a `+234` number quote
 * in ₦ even when the region dropdown was left on the default.
 */
const DIAL_CURRENCY: { dial: string; currency: string }[] = (() => {
  const byDial = new Map<string, Set<string>>()
  for (const r of REGIONS) {
    const set = byDial.get(r.dial) ?? new Set<string>()
    set.add(r.currency)
    byDial.set(r.dial, set)
  }
  return [...byDial.entries()]
    .filter(([, currencies]) => currencies.size === 1)
    .map(([dial, currencies]) => ({ dial, currency: [...currencies][0] }))
    .sort((a, b) => b.dial.length - a.dial.length) // longest prefix wins
})()

export function currencyForPhone(e164: string | null | undefined): string | null {
  const n = (e164 ?? '').trim()
  if (!n.startsWith('+')) return null
  for (const { dial, currency } of DIAL_CURRENCY) {
    if (n.startsWith(dial)) return currency
  }
  return null
}

/**
 * The single currency shared by a set of recipients, preferring each number's
 * country code over the region selector (so a `+234` number quotes in ₦ even
 * with the default US region). Null when they disagree or none resolve.
 */
export function currencyForRecipients(
  recipients: { phone?: string | null; region?: string | null }[],
): string | null {
  const set = new Set<string>()
  for (const r of recipients) set.add(currencyForPhone(r.phone) ?? regionCurrency(r.region))
  return set.size === 1 ? [...set][0] : null
}
