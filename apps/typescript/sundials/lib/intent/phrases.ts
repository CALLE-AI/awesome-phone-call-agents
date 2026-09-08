const PLACEHOLDER = /^(unknown|n\/a|none|not stated|see live transcript|—)$/i;
const CALL_STATUS_DUMP =
  /^(the\s+)?(discovery\s+)?call completed successfully\b/i;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function inferPain(text: string): string | undefined {
  if (/manual admin|spreadsheet|admin pain/i.test(text)) return "Manual administration";
  if (/no single source|fragmented|data silo/i.test(text)) return "Fragmented customer data";
  if (/reporting|forecast/i.test(text)) return "Weak reporting";
  return undefined;
}

/** Keep CALL-E wording. Only drop empty / placeholder strings. */
export function insightText(text: string | null | undefined): string | undefined {
  if (!text?.trim()) return undefined;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || PLACEHOLDER.test(cleaned) || CALL_STATUS_DUMP.test(cleaned)) return undefined;
  return cleaned;
}

export function shortInsightLabel(text: string | undefined): string | undefined {
  const cleaned = insightText(text);
  if (!cleaned) return undefined;
  const mapped = inferPain(cleaned);
  if (mapped && wordCount(cleaned) <= 8) return mapped;
  return cleaned;
}
