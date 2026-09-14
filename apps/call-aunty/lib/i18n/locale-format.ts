import type { AppLanguage } from "@/lib/language";
import { getLanguageDefinition } from "./language-registry";

export function formatDate(
  language: AppLanguage,
  date: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const locale = getLanguageDefinition(language).locale;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatTime(
  language: AppLanguage,
  date: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const locale = getLanguageDefinition(language).locale;
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", ...options }).format(date);
}

export function formatNumber(
  language: AppLanguage,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  const locale = getLanguageDefinition(language).locale;
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCurrency(
  language: AppLanguage,
  value: number,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  const locale = getLanguageDefinition(language).locale;
  return new Intl.NumberFormat(locale, { style: "currency", currency, ...options }).format(value);
}

/** Display-only phone formatting; canonical storage stays E.164. */
export function formatPhoneDisplay(phoneE164: string, region = "US"): string {
  const digits = phoneE164.replace(/\D/g, "");
  if (region === "BD" && digits.startsWith("880")) {
    const local = digits.slice(3);
    if (local.length === 10) return `+880 ${local.slice(0, 4)} ${local.slice(4)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phoneE164;
}

/** Normalize user input digits (including localized numerals) to ASCII digits. */
export function normalizeDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\u0AE6-\u0AEF\u0B66-\u0B6F\u0C66-\u0C6F]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const bases = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0ae6, 0x0b66, 0x0c66];
    for (const base of bases) {
      if (code >= base && code <= base + 9) return String(code - base);
    }
    return ch;
  });
}
