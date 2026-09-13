export type SupportedLocale = {
  code: string;
  label: string;
};

export type SupportedMarket = {
  countryCode: string;
  countryName: string;
  currency: string;
  defaultLocale: string;
  locales: SupportedLocale[];
  defaultLocation: string;
  defaultBudget: number;
  fixturePhones: readonly [string, string, string];
};

// NANPA permanently reserves 555-0100 through 555-0199 as fictitious,
// non-working numbers. Fixture plans never pass these values to CALL-E.
export const FICTIONAL_FIXTURE_PHONES = ["+12025550101", "+12025550102", "+12025550103"] as const;

export const SUPPORTED_MARKETS: readonly SupportedMarket[] = [
  { countryCode: "US", countryName: "United States", currency: "USD", defaultLocale: "en-US", locales: [{ code: "en-US", label: "English" }], defaultLocation: "Chicago, IL", defaultBudget: 180, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "SG", countryName: "Singapore", currency: "SGD", defaultLocale: "en-SG", locales: [{ code: "en-SG", label: "English" }], defaultLocation: "Singapore", defaultBudget: 240, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "MY", countryName: "Malaysia", currency: "MYR", defaultLocale: "en-MY", locales: [{ code: "en-MY", label: "English" }], defaultLocation: "Kuala Lumpur", defaultBudget: 650, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "IN", countryName: "India", currency: "INR", defaultLocale: "en-IN", locales: [{ code: "en-IN", label: "English" }, { code: "hi-IN", label: "Hindi" }], defaultLocation: "Bengaluru", defaultBudget: 12000, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "AE", countryName: "United Arab Emirates", currency: "AED", defaultLocale: "en-AE", locales: [{ code: "en-AE", label: "English" }, { code: "ar-AE", label: "Arabic" }], defaultLocation: "Dubai", defaultBudget: 650, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "AU", countryName: "Australia", currency: "AUD", defaultLocale: "en-AU", locales: [{ code: "en-AU", label: "English" }], defaultLocation: "Melbourne, VIC", defaultBudget: 280, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "CA", countryName: "Canada", currency: "CAD", defaultLocale: "en-CA", locales: [{ code: "en-CA", label: "English" }], defaultLocation: "Toronto, ON", defaultBudget: 250, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "GB", countryName: "United Kingdom", currency: "GBP", defaultLocale: "en-GB", locales: [{ code: "en-GB", label: "English" }], defaultLocation: "Birmingham", defaultBudget: 160, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "VN", countryName: "Vietnam", currency: "VND", defaultLocale: "vi-VN", locales: [{ code: "vi-VN", label: "Vietnamese" }], defaultLocation: "Ho Chi Minh City", defaultBudget: 4500000, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "DE", countryName: "Germany", currency: "EUR", defaultLocale: "de-DE", locales: [{ code: "de-DE", label: "German" }, { code: "en-DE", label: "English" }], defaultLocation: "Berlin", defaultBudget: 170, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "JP", countryName: "Japan", currency: "JPY", defaultLocale: "ja-JP", locales: [{ code: "ja-JP", label: "Japanese" }], defaultLocation: "Tokyo", defaultBudget: 28000, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "FR", countryName: "France", currency: "EUR", defaultLocale: "fr-FR", locales: [{ code: "fr-FR", label: "French" }], defaultLocation: "Lyon", defaultBudget: 170, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "MX", countryName: "Mexico", currency: "MXN", defaultLocale: "es-MX", locales: [{ code: "es-MX", label: "Spanish" }], defaultLocation: "Mexico City", defaultBudget: 3200, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "BR", countryName: "Brazil", currency: "BRL", defaultLocale: "pt-BR", locales: [{ code: "pt-BR", label: "Portuguese" }], defaultLocation: "São Paulo", defaultBudget: 850, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "ID", countryName: "Indonesia", currency: "IDR", defaultLocale: "en-ID", locales: [{ code: "en-ID", label: "English" }], defaultLocation: "Jakarta", defaultBudget: 2800000, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "PH", countryName: "Philippines", currency: "PHP", defaultLocale: "en-PH", locales: [{ code: "en-PH", label: "English" }], defaultLocation: "Metro Manila", defaultBudget: 10000, fixturePhones: FICTIONAL_FIXTURE_PHONES },
  { countryCode: "KE", countryName: "Kenya", currency: "KES", defaultLocale: "en-KE", locales: [{ code: "en-KE", label: "English" }], defaultLocation: "Nairobi CBD", defaultBudget: 8000, fixturePhones: FICTIONAL_FIXTURE_PHONES },
] as const;

export function getSupportedMarket(countryCode: string): SupportedMarket | undefined {
  return SUPPORTED_MARKETS.find((market) => market.countryCode === countryCode);
}

export function supportsMarketLocale(countryCode: string, locale: string): boolean {
  return getSupportedMarket(countryCode)?.locales.some((candidate) => candidate.code === locale) ?? false;
}
