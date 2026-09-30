import type { RepairRule } from './model';
import { explicitDollars } from './money';

export const REPAIR_VERSION = '2';
export const repairRules: RepairRule[] = ['explicit_usd', 'source_reference'];
export const repairLabels: Record<RepairRule, string> = {
  explicit_usd: 'Dollar amount corrections',
  source_reference: 'Source reference corrections',
};

/** A deliberately small grammar: discounts, ranges, arithmetic, qualifiers and
 * multi-part amounts cannot be silently reinterpreted as a final dollar total. */
export function repairableDollars(quote: string, recipientTurn: string): number | null {
  if (quote.trim() !== recipientTurn.trim()) return null;
  if (
    !/^(?:(?:the (?:total|price|cost)(?: is)?|it (?:is|costs|will be)|that(?:'s| is))\s+)?(?:\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|USD\s+(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s+(?:US\s+)?dollars?|(?:(?:one|a)\s+)?thousand\s+dollars?)[.!]?$/i.test(
      quote.trim(),
    )
  )
    return null;
  return explicitDollars(quote.trim());
}
