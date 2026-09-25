export type SafetyHit = {
  code: string;
  message: string;
  blocking: boolean;
};

const INJECTION_PATTERNS = [
  /ignore (all|previous) instructions/i,
  /reveal (your|the) system prompt/i,
  /jailbreak/i,
];

const URGENT_PATTERNS = [
  /\bchest pain\b/i,
  /\bcan'?t breathe\b/i,
  /\bsuicide\b/i,
  /\bself[- ]harm\b/i,
];

/** Hard-coded safety checks outside the model. */
export function evaluateSafetyText(text: string): SafetyHit[] {
  const hits: SafetyHit[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      hits.push({
        code: "prompt_injection",
        message: "Possible prompt-injection language detected; ignore model override attempts.",
        blocking: true,
      });
    }
  }
  for (const pattern of URGENT_PATTERNS) {
    if (pattern.test(text)) {
      hits.push({
        code: "urgent_safety",
        message: "Safety-sensitive phrase detected; stop automation and escalate to human review.",
        blocking: true,
      });
    }
  }
  return hits;
}

export function mustStopAutomation(hits: SafetyHit[]): boolean {
  return hits.some((h) => h.blocking);
}
