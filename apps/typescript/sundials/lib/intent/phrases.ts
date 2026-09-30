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

const YEAR_TOKEN = /^(?:19|20)\d{2}$/;

/** Chart label only. Keep the original company-size sentence on the lead profile. */
export function companySizeChartLabel(text: string | null | undefined): string | undefined {
  const cleaned = insightText(text);
  if (!cleaned) return undefined;

  const range = cleaned.match(/\b(\d{1,3})\s*[–-]\s*(\d{1,6})\b/);
  if (range) return `${Number(range[1])}–${Number(range[2])}`;

  for (const match of cleaned.matchAll(/\d{1,3}(?:,\d{3})+|\d+/g)) {
    const digits = match[0].replace(/,/g, "");
    if (YEAR_TOKEN.test(digits)) continue;
    const n = Number(digits);
    if (!Number.isFinite(n) || n <= 0) continue;
    return n.toLocaleString("en-US");
  }
  return undefined;
}
