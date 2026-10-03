import type { AppLanguage } from "@/lib/language";
import { getLanguageDefinition } from "./language-registry";

export type RtlIconPolicy = "flip" | "keep";

/** Icons that mirror in RTL layouts. */
export const RTL_FLIP_ICONS = new Set([
  "chevron-back",
  "chevron-forward",
  "arrow-back",
  "arrow-forward",
  "caret-back",
  "caret-forward",
]);

export function getWritingDirection(language: AppLanguage): "ltr" | "rtl" {
  return getLanguageDefinition(language).direction;
}

export function shouldFlipIcon(iconName: string): boolean {
  return RTL_FLIP_ICONS.has(iconName);
}

export function mirrorStyleForRtl(language: AppLanguage, iconName: string) {
  if (getWritingDirection(language) !== "rtl") return undefined;
  if (!shouldFlipIcon(iconName)) return undefined;
  return { transform: [{ scaleX: -1 as const }] };
}

export function rtlFlexDirection(language: AppLanguage): "row" | "row-reverse" {
  return getWritingDirection(language) === "rtl" ? "row-reverse" : "row";
}

/** Dev-only harness flag stored in memory (not persisted). */
let rtlTestOverride: "ltr" | "rtl" | null = null;

export function setRtlTestOverride(direction: "ltr" | "rtl" | null) {
  rtlTestOverride = direction;
}

export function getEffectiveDirection(language: AppLanguage): "ltr" | "rtl" {
  return rtlTestOverride ?? getWritingDirection(language);
}
