import type { AppLanguage } from "@/lib/language";
import { FALLBACK_LANGUAGE_CHAIN, getLanguageDefinition, SUPPORTED_UI_LANGUAGES } from "./language-registry";
import { resolveFlatValue } from "./catalog";
import type { InterpolationValues } from "./types";

const missingKeyLog = new Set<string>();

const FALLBACK_CHAINS = Object.fromEntries(
  SUPPORTED_UI_LANGUAGES.map((language) => [
    language,
    [language, ...FALLBACK_LANGUAGE_CHAIN.filter((item) => item !== language)],
  ]),
) as unknown as Record<AppLanguage, readonly AppLanguage[]>;

function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

function resolveKey(language: AppLanguage, key: string): { value?: string; resolvedLanguage: AppLanguage } {
  const chain = FALLBACK_CHAINS[language] ?? [language, "en"];
  for (const lang of chain) {
    const value = resolveFlatValue(lang, key);
    if (value !== undefined) return { value, resolvedLanguage: lang };
  }
  return { resolvedLanguage: language };
}

export type TranslateOptions = {
  language: AppLanguage;
  values?: InterpolationValues;
  /** Production-safe fallback when key is entirely missing. */
  fallback?: string;
};

/**
 * Translate a dotted localization key, e.g. `billing.title`.
 * Fallback: requested → English. Never shows raw keys in production.
 */
export function t(key: string, options: TranslateOptions): string {
  const { value } = resolveKey(options.language, key);
  if (value !== undefined) {
    return interpolate(value, options.values);
  }

  const logId = `${options.language}:${key}`;
  const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
  if (isDev && !missingKeyLog.has(logId)) {
    missingKeyLog.add(logId);
    console.warn(`[i18n] missing key "${key}" for ${options.language}`);
  }

  if (options.fallback) return interpolate(options.fallback, options.values);
  if (isDev) return `[missing:${key}]`;
  return interpolate(key.split(".").pop() ?? key, options.values);
}

export function pluralize(
  language: AppLanguage,
  keyBase: string,
  count: number,
  options?: Omit<TranslateOptions, "language"> & { language: AppLanguage },
): string {
  const rules = getLanguageDefinition(language).pluralRules;
  const category = rules.select(count);
  const keyed = `${keyBase}.${category}`;
  const specific = resolveKey(language, keyed).value;
  if (specific) return interpolate(specific, options?.values);
  const other = resolveKey(language, `${keyBase}.other`).value;
  if (other) return interpolate(other, { ...options?.values, count });
  return t(`${keyBase}.one`, { ...options, language, values: { ...options?.values, count } });
}

export function resetMissingKeyLogForTests() {
  missingKeyLog.clear();
}
