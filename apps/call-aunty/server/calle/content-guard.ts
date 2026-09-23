const UNSAFE_PATTERNS = [
  /\bdiagnos(e|is|ed|ing)\b/i,
  /\bprescri(be|ption|bed|bing)\b/i,
  /\b\d+\s*mg\b/i,
  /\b(take|use)\s+\d+\s+(pills?|tablets?|doses?)\b/i,
  /\bdefinitely\s+(have|has|cancer|infection)\b/i,
];

export class UnsafeCallContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeCallContentError";
  }
}

export function assertSafeCallContent(text: string): void {
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      throw new UnsafeCallContentError("Call plan contains prohibited clinical language.");
    }
  }
}

export function isSafeCallContent(text: string): boolean {
  try {
    assertSafeCallContent(text);
    return true;
  } catch {
    return false;
  }
}
