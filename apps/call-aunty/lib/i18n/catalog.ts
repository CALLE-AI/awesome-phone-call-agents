import type { AppLanguage } from "@/lib/language";
import { bn } from "./locales/bn";
import { en } from "./locales/en";
import { hi } from "./locales/hi";
import { ta } from "./locales/ta";
import { te } from "./locales/te";
import { ur } from "./locales/ur";
import type { TranslationTree } from "./types";

export const LOCALE_PACKS: Record<AppLanguage, TranslationTree> = {
  bn,
  en,
  hi,
  ur,
  ta,
  te,
};

function flattenTree(tree: TranslationTree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else flattenTree(value, path, out);
  }
  return out;
}

/** Flat dotted-key maps built once at module load so `t()` is O(1). */
export const FLAT_LOCALE_PACKS: Record<AppLanguage, Readonly<Record<string, string>>> = {
  bn: flattenTree(bn),
  en: flattenTree(en),
  hi: flattenTree(hi),
  ur: flattenTree(ur),
  ta: flattenTree(ta),
  te: flattenTree(te),
};

export function flattenKeys(tree: TranslationTree, prefix = "", out: string[] = []): string[] {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.push(path);
    else flattenKeys(value, path, out);
  }
  return out;
}

let canonicalEnglishKeys: string[] | undefined;

export function getCanonicalEnglishKeys(): string[] {
  canonicalEnglishKeys ??= Object.keys(FLAT_LOCALE_PACKS.en).sort();
  return canonicalEnglishKeys;
}

export function resolveTreeValue(tree: TranslationTree, keyPath: string): string | undefined {
  const parts = keyPath.split(".");
  let node: string | TranslationTree | undefined = tree;
  for (const part of parts) {
    if (typeof node !== "object" || node === null || !(part in node)) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function resolveFlatValue(language: AppLanguage, keyPath: string): string | undefined {
  return FLAT_LOCALE_PACKS[language]?.[keyPath];
}
