/**
 * Stage code — short spoken challenge that binds a line reading to the
 * person on the call sheet (identity read-back), not whoever picks up the phone.
 */
import type { AccountEvent } from "../schemas.js";

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/** Digits only, max 8 chars. */
export function normalizeStageCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).replace(/\D/g, "").slice(0, 8);
}

/**
 * Stable 4-digit stage code for a cue.
 * Prefer last 4 ticket digits when available; else hash of event_id.
 */
export function stageCodeForEvent(event: AccountEvent): string {
  const ticketDigits = normalizeStageCode(event.ticket_id);
  if (ticketDigits.length >= 4) return ticketDigits.slice(-4);

  let h = 2166136261;
  for (let i = 0; i < event.event_id.length; i++) {
    h ^= event.event_id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(1000 + (h % 9000));
}

/** Extract a digit sequence from spoken / typed transcript text. */
export function digitsFromSpeech(text: string): string {
  const lower = text.toLowerCase();
  // Prefer contiguous digit runs of length 3–6
  const runs = lower.match(/\d{3,6}/g);
  if (runs?.length) return runs[runs.length - 1];

  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (const t of tokens) {
    if (/^\d$/.test(t)) {
      out.push(t);
      continue;
    }
    const w = DIGIT_WORDS[t];
    if (w) out.push(w);
  }
  return out.join("");
}

export function stageCodeSpokenInTexts(
  expected: string,
  texts: string[] | undefined,
): boolean {
  const want = normalizeStageCode(expected);
  if (!want || !texts?.length) return false;
  for (const t of texts) {
    const got = digitsFromSpeech(t);
    if (got.includes(want)) return true;
    // Also accept spaced digits matching exactly when normalized from the turn
    if (normalizeStageCode(t) === want) return true;
  }
  return false;
}

export type IdentityCheck =
  | { ok: true; source: "structured" | "flag" | "transcript" | "dress_rehearsal" }
  | { ok: false; reason: "mismatch" | "missing" | "denied" };

/**
 * Did the callee prove they know the stage code?
 * Curtain-up must pass this before a 1/2/3 decision is recorded as theirs.
 */
export function checkIdentityReadback(args: {
  expectedStageCode: string;
  structured?: Record<string, unknown> | null;
  transcriptTexts?: string[];
  /** Dress rehearsal skips live proof. */
  dressRehearsal?: boolean;
}): IdentityCheck {
  if (args.dressRehearsal) {
    return { ok: true, source: "dress_rehearsal" };
  }

  const expected = normalizeStageCode(args.expectedStageCode);
  if (!expected) return { ok: false, reason: "missing" };

  const structured = args.structured;
  if (structured && structured.identity_confirmed === false) {
    return { ok: false, reason: "denied" };
  }

  const spoken = normalizeStageCode(
    structured && structured.stage_code != null
      ? String(structured.stage_code)
      : "",
  );
  if (spoken) {
    return spoken === expected
      ? { ok: true, source: "structured" }
      : { ok: false, reason: "mismatch" };
  }

  if (structured && structured.identity_confirmed === true) {
    // Flag alone is weak — still require code or transcript evidence
    if (stageCodeSpokenInTexts(expected, args.transcriptTexts)) {
      return { ok: true, source: "flag" };
    }
    return { ok: false, reason: "missing" };
  }

  if (stageCodeSpokenInTexts(expected, args.transcriptTexts)) {
    return { ok: true, source: "transcript" };
  }

  return { ok: false, reason: "missing" };
}
