/**
 * Runtime-checkable CALL-E capability registry.
 * Does not claim Bangla/Bangladesh support unless explicitly listed.
 */
export const CALLE_CAPABILITY = {
  provider: "@call-e/calle",
  providerVersion: "0.7.x",
  modes: ["dry_run", "live"] as const,
  operations: ["createAndWait", "get", "listEvents"] as const,
  /** No cancel API in current SDK — local cancel only. */
  cancelSupported: false,
  webhookSupported: true,
  pollingSupported: true,
  supportedRegions: ["US", "CA", "GB", "AU"] as const,
  supportedCallLanguages: ["en", "en-us", "en-gb", "es", "fr"] as const,
  /** Explicitly not supported for demo/hackathon honesty. */
  unsupportedClaims: ["BD", "Bangladesh", "bn", "Bangla spoken agent"] as const,
} as const;

export type CalleRegion = (typeof CALLE_CAPABILITY.supportedRegions)[number];
export type CalleCallLanguage = (typeof CALLE_CAPABILITY.supportedCallLanguages)[number];

export function isSupportedRegion(region: string): boolean {
  return (CALLE_CAPABILITY.supportedRegions as readonly string[]).includes(region.toUpperCase());
}

export function isSupportedCallLanguage(language: string): boolean {
  const normalized = language.toLowerCase();
  return CALLE_CAPABILITY.supportedCallLanguages.some(
    (code) => normalized === code || normalized.startsWith(`${code}-`),
  );
}

export function getCapabilitySnapshot() {
  return {
    ...CALLE_CAPABILITY,
    supportedRegions: [...CALLE_CAPABILITY.supportedRegions],
    supportedCallLanguages: [...CALLE_CAPABILITY.supportedCallLanguages],
    unsupportedClaims: [...CALLE_CAPABILITY.unsupportedClaims],
  };
}
