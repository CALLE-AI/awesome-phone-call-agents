export type VoiceAnswerIntent = "yes" | "no" | "unclear";

const YES_TOKENS = [
  "yes",
  "yeah",
  "yep",
  "yea",
  "true",
  "help",
  "haan",
  "haa",
  "ha",
  "ji",
  "জি",
  "হ্যাঁ",
  "হ্যা",
  "আছে",
  "দরকার",
  "हाँ",
  "हां",
  "जी",
  "ہاں",
  "هاں",
  "جی",
];

const NO_TOKENS = [
  "no",
  "nope",
  "nah",
  "false",
  "not",
  "na",
  "nahi",
  "nai",
  "না",
  "নাই",
  "নেই",
  "नहीं",
  "नही",
  "ना",
  "نہیں",
  "نهیں",
  "نہيں",
];

function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesToken(haystack: string, token: string): boolean {
  const needle = normalizeTranscript(token);
  if (!needle) return false;
  if ([...needle].length <= 2) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "iu").test(haystack);
  }
  return haystack.includes(needle);
}

/** Map a short spoken reply to a yes/no check-in answer across supported languages. */
export function classifyVoiceAnswer(transcript: string): VoiceAnswerIntent {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return "unclear";

  const yesHit = YES_TOKENS.some((token) => includesToken(normalized, token));
  const noHit = NO_TOKENS.some((token) => includesToken(normalized, token));

  if (yesHit && !noHit) return "yes";
  if (noHit && !yesHit) return "no";
  return "unclear";
}
