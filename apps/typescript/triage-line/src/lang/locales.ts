/**
 * Country -> allowed locales table and language auto-retry helper.
 *
 * When a call returns low confidence with evidence of a language barrier, the
 * executor re-spawns the node with the next allowed locale for that country.
 * This is our "self-healing across a language barrier" behaviour and is fully
 * under our control (Level-1 language selection), independent of whether CALL-E
 * honours a mid-call "switch language" instruction (best-effort).
 */

/** Ordered locale preferences per region. First is the default attempt. */
export const REGION_LOCALES: Record<string, string[]> = {
  US: ["en-US", "es-MX", "zh-CN"],
  MX: ["es-MX", "en-US"],
  CA: ["en-CA", "fr-CA"],
  ES: ["es-ES", "en-US"],
  BR: ["pt-BR", "es-MX", "en-US"],
  IN: ["en-IN", "hi-IN"],
  FR: ["fr-FR", "en-US"],
};

/**
 * Given a region and the locales already attempted, return the next locale to
 * try, or undefined if the list is exhausted.
 */
export function nextLocale(
  region: string,
  attempted: string[]
): string | undefined {
  const options = REGION_LOCALES[region] ?? ["en-US"];
  return options.find((loc) => !attempted.includes(loc));
}
