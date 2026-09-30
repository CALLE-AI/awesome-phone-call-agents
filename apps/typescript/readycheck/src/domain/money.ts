/** Only unambiguous explicit dollar expressions. Unrecognized language remains unknown. */
export function explicitDollars(text: string): number | null {
  if (/\b(?:CAD|AUD|Canadian|Australian|euros?|pounds?|cents?)\b/i.test(text)) return null;
  // Do not turn a signed amount into a positive quote.
  if (/[+-]\s*\$\s*\d/.test(text)) return null;
  const values = [
    ...text.matchAll(
      /(?:\$\s*|\bUSD\s+)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![a-z\d]|[.,](?:[.,]|\s*\d))|(?<![\w.,+-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s+(?:US\s+)?dollars?\b/gi,
    ),
  ].map((m) =>
    Math.round(Number((m[1] || m[3]).replaceAll(',', '') + '.' + (m[2] || m[4] || '0')) * 100),
  );
  // Match the whole spoken amount: never read "twenty-one thousand" as "one thousand".
  // Only the explicitly supported thousand-dollar forms are normalized here.
  const spokenAmounts = text.matchAll(
    /\b((?:(?:a|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|and|point|\d+(?:\.\d+)?)[\s-]+)+)(?:US\s+)?dollars?\b/gi,
  );
  for (const match of spokenAmounts) {
    const amount = match[1].trim().replace(/\s+/g, ' ').toLowerCase();
    if (/^\d+(?:\.\d+)?$/.test(amount)) continue; // Already parsed above.
    if (!/^(?:(?:one|a) )?thousand$/.test(amount)) return null;
    values.push(100000);
  }
  if (values.length !== 1 || !Number.isSafeInteger(values[0])) return null;
  return values[0];
}
