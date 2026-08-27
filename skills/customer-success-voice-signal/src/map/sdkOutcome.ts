/**
 * Prefer CALL-E SDK outcome fields over summary-string heuristics.
 * failureCode / attempt failureCode → no_answer when the platform says so.
 * completionConfidence low → never invent a 1/2/3 decision.
 */
export type CompletionConfidence = {
  score: number;
  label: string;
} | null;

const NO_ANSWER_CODE_RE =
  /voicemail|no[_-]?answer|unreachable|busy|did[_-]?not[_-]?answer|noanswer|recipient[_-]?unavailable|not[_-]?available/i;

/** Machine-readable codes that mean the human never gave a line reading. */
export function failureCodesSuggestNoAnswer(
  ...codes: Array<string | null | undefined>
): boolean {
  for (const c of codes) {
    if (!c) continue;
    if (NO_ANSWER_CODE_RE.test(c)) return true;
  }
  return false;
}

/** Collect call-level + attempt-level failure codes from a Call-shaped object. */
export function collectFailureCodes(call: {
  failureCode?: string | null;
  recipients?: Array<{
    failureCode?: string | null;
    attempts?: Array<{ failureCode?: string | null; failureMessage?: string | null }>;
  }>;
}): string[] {
  const out: string[] = [];
  if (call.failureCode) out.push(call.failureCode);
  for (const r of call.recipients ?? []) {
    if (r.failureCode) out.push(r.failureCode);
    for (const a of r.attempts ?? []) {
      if (a.failureCode) out.push(a.failureCode);
    }
  }
  return out;
}

export function collectFailureMessages(call: {
  failureMessage?: string | null;
  recipients?: Array<{
    attempts?: Array<{ failureMessage?: string | null }>;
  }>;
}): string[] {
  const out: string[] = [];
  if (call.failureMessage) out.push(call.failureMessage);
  for (const r of call.recipients ?? []) {
    for (const a of r.attempts ?? []) {
      if (a.failureMessage) out.push(a.failureMessage);
    }
  }
  return out;
}

/**
 * Low confidence → refuse a normal decision.
 * Missing confidence is OK (older responses / dress rehearsal).
 */
export function isLowCompletionConfidence(
  confidence: CompletionConfidence | undefined,
  minScore = 0.45,
): boolean {
  if (!confidence) return false;
  if (typeof confidence.score === "number" && confidence.score < minScore) {
    return true;
  }
  const label = (confidence.label ?? "").toLowerCase();
  return label === "low";
}

/** Last-resort summary heuristic — only when SDK codes are absent. */
export function summaryLooksLikeVoicemailOrNoAnswer(
  summary: string | null | undefined,
): boolean {
  if (!summary) return false;
  const s = summary.toLowerCase();
  return (
    s.includes("voicemail") ||
    s.includes("not available") ||
    s.includes("no answer") ||
    s.includes("didn't answer") ||
    s.includes("did not answer") ||
    s.includes("unreachable") ||
    s.includes("did not connect") ||
    s.includes("didn't connect") ||
    s.includes("no transcript") ||
    s.includes("busy or unavailable") ||
    s.includes("may be busy")
  );
}
