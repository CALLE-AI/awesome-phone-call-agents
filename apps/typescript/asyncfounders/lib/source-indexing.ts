export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 250;
export const MAX_EXTRACTED_CHARACTERS = 1_400_000;

export function normalizeSourceText(text: string) {
  return text
    .replace(/\0/g, "")
    .replace(/\r/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunksOf(text: string) {
  const clean = normalizeSourceText(text);
  const chunks: string[] = [];

  for (let cursor = 0; cursor < clean.length; cursor += 1400) {
    chunks.push(clean.slice(cursor, cursor + 1600));
  }

  return chunks.filter(Boolean);
}
