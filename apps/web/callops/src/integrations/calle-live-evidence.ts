import { sanitizeCallePlanText } from './calle-plan-response';

const INJECTION_PATTERN =
  /\b(?:ignore (?:all |the )?(?:previous|prior) instructions?|system prompt|disclose all|reveal (?:all |the )?(?:customer|private|secret)|invoke|execute|run_call|plan_call|tool call)\b/iu;

export interface SanitizedCalleRemoteEvidence {
  readonly transcript: readonly string[];
  readonly summary: string | null;
  readonly failureReason: string | null;
  readonly securitySignals: readonly string[];
}

function safeRemoteText(
  value: unknown,
  signals: Set<string>,
  maxLength = 800,
): string | null {
  if (typeof value !== 'string') {
    if (value !== null && value !== undefined) signals.add('REMOTE_NON_TEXT_EVIDENCE_IGNORED');
    return null;
  }
  const sanitized = sanitizeCallePlanText(value);
  if (sanitized === null) {
    signals.add('REMOTE_TEXT_REDACTED');
    return null;
  }
  if (INJECTION_PATTERN.test(sanitized)) signals.add('INDIRECT_PROMPT_INJECTION_DETECTED');
  return sanitized.slice(0, maxLength);
}

export function sanitizeCalleRemoteEvidence(input: {
  readonly transcript: readonly unknown[];
  readonly summary: unknown;
  readonly failureReason: unknown;
}): SanitizedCalleRemoteEvidence {
  const signals = new Set<string>();
  const transcript = input.transcript
    .map((line) => safeRemoteText(line, signals))
    .filter((line): line is string => line !== null);
  return Object.freeze({
    transcript: Object.freeze(transcript),
    summary: safeRemoteText(input.summary, signals),
    failureReason: safeRemoteText(input.failureReason, signals),
    securitySignals: Object.freeze([...signals].sort()),
  });
}
