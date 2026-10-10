const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/**
 * Normalizes speech-to-text artifacts in transcripts (such as "capitalized S, capitalized T, three, two")
 * into natural part numbers and acronyms (e.g. "STM32H743ZI"), while strictly preserving genuine prose.
 */
export function formatNaturalTranscriptText(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // 1. Remove [MOCK DEMO] prefix if present
  cleaned = cleaned.replace(/^\[MOCK DEMO\]\s*/i, '');

  // 2. Normalize "capitalized X" or "capital X" or "uppercase X"
  cleaned = cleaned.replace(/\b(?:capitalized|capital|uppercase)\s+([a-zA-Z0-9])\b/gi, '$1');

  // 3. Replace spelled-out digit words when part of letter-number sequences
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(
      /\b([a-zA-Z0-9])\s*,\s*(zero|one|two|three|four|five|six|seven|eight|nine)\b/gi,
      (_, letter, word) => `${letter}, ${DIGIT_WORDS[word.toLowerCase()] || word}`
    );
    cleaned = cleaned.replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine)\s*,\s*([a-zA-Z0-9])\b/gi,
      (_, word, letter) => `${DIGIT_WORDS[word.toLowerCase()] || word}, ${letter}`
    );
    cleaned = cleaned.replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine)\s*,\s*(zero|one|two|three|four|five|six|seven|eight|nine)\b/gi,
      (_, w1, w2) => `${DIGIT_WORDS[w1.toLowerCase()] || w1}, ${DIGIT_WORDS[w2.toLowerCase()] || w2}`
    );
  }

  // 4. Combine adjacent single-letter/single-digit sequences separated by commas or spaces into a single part code
  // e.g. "S, T, M, 3, 2, H, 7, 4, 3, Z, I" -> "STM32H743ZI"
  cleaned = cleaned.replace(/\b([A-Z0-9])(?:,\s*|\s+)(?=[A-Z0-9](?:,\s*|\s+|[,\.\?!;:]|$))/g, (_, p1) => {
    return p1;
  });

  // 5. Clean up any remaining double spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  return cleaned;
}
