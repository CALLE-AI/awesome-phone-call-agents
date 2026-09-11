import type { ConciergeCta } from "@/lib/types";

/** Copies `data-sc-*` except `data-sc-cta` (e.g. `data-sc-plan` → `plan`). */
export function scDatasetProperties(
  attributes: ArrayLike<{ name: string; value: string }>
): Record<string, string> {
  const extra: Record<string, string> = {};
  for (let i = 0; i < attributes.length; i++) {
    const attr = attributes[i];
    if (!attr.name.startsWith("data-sc-") || attr.name === "data-sc-cta") continue;
    const key = attr.name.slice("data-sc-".length).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const value = attr.value.trim();
    if (key && value) extra[key] = value;
  }
  return extra;
}

export function parseConciergeCta(value: string | null | undefined): ConciergeCta | null {
  if (value === "talk_to_sales" || value === "get_demo" || value === "learn_more") return value;
  return null;
}

/** `data-sc-open` means this site button should open the widget instead of following its href. */
export function ctaOpensWidget(el: {
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
}): ConciergeCta | null {
  if (!el.hasAttribute("data-sc-open")) return null;
  return parseConciergeCta(el.getAttribute("data-sc-cta")) || "talk_to_sales";
}
