/** Normalize provider responses and read call evidence without loading the API client. */
import type { Call } from "@call-e/calle";
import type { CallRecord, ClarificationAnswer, Evidence, TranscriptTurn } from "./types";

export function normalizeCall(call: Call): CallRecord {
  // One candidate per call, so the first recipient's latest attempt is the call.
  const recipient = call.recipients[0] ?? null;
  const attempt = recipient?.attempts.at(-1) ?? null;

  const transcript: TranscriptTurn[] = (attempt?.transcriptTurns ?? []).map((t) => ({
    offsetSeconds: t.offset_seconds,
    speaker: t.speaker,
    text: t.text,
  }));

  return {
    callId: call.id,
    status: call.status,
    attemptStatus: attempt?.status ?? null,
    summary: call.summary ?? recipient?.summary ?? null,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence
      ? { score: call.completionConfidence.score, label: call.completionConfidence.label }
      : null,
    taskEvidence: call.evidence ?? [],
    transcript,
    // Prefer the task-level result; fall back to the recipient-level one so a
    // recipient_result_schema run still renders.
    structuredResult: call.structuredResult ?? recipient?.structuredResult ?? null,
    // The attempt-level code is the one that says what happened on the wire
    // (`603`, `486`); the call-level code is a roll-up that only restates
    // `status` — a DECLINED call reports `call_failed`, which diagnoses
    // nothing. Prefer the specific one, and fall back to the call for failures
    // that happen before any attempt exists.
    failureCode: attempt?.failureCode ?? call.failureCode ?? null,
    failureMessage: attempt?.failureMessage ?? call.failureMessage ?? null,
    createdAt: call.createdAt,
    completedAt: call.completedAt,
  };
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Structured result → domain
// ---------------------------------------------------------------------------

const CONFIDENCES = new Set(["high", "medium", "low"]);

/** Reads one clarification's answer object out of the structured result. */
export function readAnswer(
  structuredResult: Record<string, unknown> | null,
  id: string,
): ClarificationAnswer | null {
  const raw = structuredResult?.[id];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const confidence = str(o.confidence).toLowerCase();
  return {
    corrected: str(o.corrected),
    correction: str(o.correction),
    basis: str(o.basis),
    headline: str(o.headline),
    answer: str(o.answer),
    specifics: str(o.specifics),
    still_unclear: str(o.still_unclear),
    open_question: str(o.open_question),
    quote: str(o.quote),
    confidence: (CONFIDENCES.has(confidence) ? confidence : "low") as "high" | "medium" | "low",
  };
}

// ---------------------------------------------------------------------------
// Evidence: match an extracted quote back onto a transcript turn
// ---------------------------------------------------------------------------

/**
 * CALL-E's `evidence` is a flat `string[]` about the task as a whole, with no
 * timestamps and no link to a schema field — so it cannot back a per-claim card
 * on its own. The per-field `quote` carries the candidate's words; matching it
 * onto a transcript turn is what gives the card its `[02:14]` stamp.
 */
export function matchEvidence(quote: string, transcript: TranscriptTurn[]): Evidence | null {
  const cleaned = quote.trim();
  if (!cleaned) return null;

  const needle = canonical(cleaned);
  if (!needle) return null;

  let bestIndex = -1;
  let bestScore = 0;

  for (const [i, turn] of transcript.entries()) {
    // The evidence must be the candidate's words, never the AI caller's.
    if (turn.speaker === "bot") continue;
    const hay = canonical(turn.text);
    if (!hay) continue;

    // Substring match either way wins outright; transcription drift means the
    // quote is sometimes a clean-up of the turn and sometimes a slice of it.
    const score =
      hay.includes(needle) || needle.includes(hay) ? 1 : overlap(needle, hay);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  // Below this, the "match" is just common words and the timestamp would lie.
  if (bestScore < 0.5 || bestIndex === -1) {
    return { quote: cleaned, offsetSeconds: null, turnIndex: -1 };
  }

  return {
    quote: cleaned,
    offsetSeconds: transcript[bestIndex]!.offsetSeconds,
    turnIndex: bestIndex,
  };
}

/** Lowercased, punctuation-stripped text, for comparing two spoken strings. */
export function canonical(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fraction of the quote's words present in the turn. */
function overlap(needle: string, hay: string): number {
  const words = needle.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  const hayWords = new Set(hay.split(" "));
  const hits = words.filter((w) => hayWords.has(w)).length;
  return hits / words.length;
}

/** `134` → `02:14`. */
export function formatOffset(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  const mm = String(Math.floor(whole / 60)).padStart(2, "0");
  const ss = String(whole % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
