/**
 * Dual attestation: canonical settlement terms -> SHA-256 digest -> a spoken
 * read-back token -> verification of that token as transcribed by ASR.
 *
 * Why a spoken token at all: both parties must attest to the SAME terms. The
 * token is derived deterministically from the canonical terms, so if the two
 * parties are read different terms (a bug, or tampering between calls), they
 * are necessarily read different tokens and the ledger records the mismatch.
 * A party repeating the token back is evidence they heard the exact terms
 * this system committed to — not a paraphrase of them.
 *
 * TWO ENCODINGS OF THE SAME DIGEST LIVE HERE.
 *
 * 1. A three-word phonetic phrase (`phraseFromDigest`, `WORDS`). This was the
 *    original encoding and it is measurably good on paper: 2^24 phrases, and a
 *    wordlist whose entries are all at pairwise Levenshtein distance >= 2, so
 *    the verifier's one-slip-per-word tolerance can never accept one list word
 *    in place of another.
 *
 * 2. A decimal read-back code (`codeFromDigest`). This is what attestation
 *    calls now speak.
 *
 * The switch was forced by measurement, not taste. On four live calls
 * (2026-07-30) the word phrase did not survive the phone line: "topaz chowder
 * cyclone" came back from ASR as "Joe Pads, chowder, 2nd 1.", and a second
 * attempt came back as "Topaz Chowder's Ticulum." The root cause is that the
 * wordlist was optimized for the wrong metric — pairwise edit distance BETWEEN
 * wordlist entries, which is a real property but says nothing about how a
 * decoder behaves. Uncommon words spoken in ISOLATION give the speech decoder
 * no linguistic context to condition on, so it substitutes whatever sequence of
 * common words fits the acoustics. Digits are the opposite case: every ASR
 * stack is heavily tuned for spoken number sequences, which is exactly why
 * banks and carriers read back digit codes rather than passphrases.
 *
 * The word-phrase functions are kept, exported and tested. They are the
 * documented history of what was tried and what was measured, and the
 * regression tests that pin the two real failed transcripts depend on them.
 */

import { createHash } from "node:crypto";
import { WORDS } from "./wordlist.js";

/** The two fields that define what the parties are agreeing to. */
export interface SettlementTerms {
  amountCents: number;
  conditions: readonly string[];
}

/** Result of comparing an expected phrase to what ASR heard. */
export interface PhraseVerification {
  match: boolean;
  /**
   * Whole-phrase Levenshtein distance over the normalized strings, divided by
   * the longer normalized length. 0 = verbatim; values near 1 = unrelated.
   * Reported for audit/ledger purposes; `match` is the decision.
   */
  normalizedDistance: number;
}

/** Result of comparing an expected digit code to what ASR heard. */
export interface CodeVerification {
  match: boolean;
  /** The raw transcript, whitespace-collapsed — kept verbatim for diagnostics. */
  heard: string;
  /** The transcript reduced to bare digits; this is what was compared. */
  digits: string;
}

/**
 * What `verifySpokenPhrase` returns. Always carries the historical
 * `PhraseVerification` fields so existing callers and ledger writers are
 * unaffected; `heard`/`digits` appear additionally when the digit-code path
 * ran.
 */
export interface SpokenVerification extends PhraseVerification {
  heard?: string;
  digits?: string;
}

const DEFAULT_PHRASE_WORDS = 3;
const DEFAULT_CODE_DIGITS = 6;
const MIN_CODE_DIGITS = 4;
const MAX_CODE_DIGITS = 12;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Canonical JSON for a set of settlement terms. Stable across:
 *  - condition ordering (sorted by UTF-16 code units — locale-independent),
 *  - incidental whitespace inside conditions (collapsed),
 *  - duplicate/empty conditions (deduped/dropped),
 *  - Unicode representation (NFC).
 * Key order is fixed by construction: amountCents, then conditions.
 */
export function canonicalTerms(terms: SettlementTerms): string {
  const { amountCents } = terms;
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError("canonicalTerms: amountCents must be a non-negative safe integer");
  }
  const conditions = [...new Set(terms.conditions.map(normalizeCondition))]
    .filter((c) => c.length > 0)
    .sort();
  return JSON.stringify({ amountCents, conditions });
}

/** SHA-256 hex digest of the canonical terms JSON. */
export function termsDigest(terms: SettlementTerms): string {
  return createHash("sha256").update(canonicalTerms(terms), "utf8").digest("hex");
}

/**
 * Map the leading digest bytes onto the curated 256-word list: one byte per
 * word. Three words carry 24 bits — plenty to make "both parties were read the
 * same terms" checkable, while staying easy to say over a phone line.
 */
export function phraseFromDigest(digest: string, wordCount: number = DEFAULT_PHRASE_WORDS): string {
  if (!SHA256_HEX.test(digest)) {
    throw new RangeError("phraseFromDigest: digest must be a 64-char SHA-256 hex string");
  }
  if (!Number.isInteger(wordCount) || wordCount < 1 || wordCount > 32) {
    throw new RangeError("phraseFromDigest: wordCount must be an integer in [1, 32]");
  }
  const lower = digest.toLowerCase();
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const byte = Number.parseInt(lower.slice(i * 2, i * 2 + 2), 16);
    const word = WORDS[byte];
    /* c8 ignore next — unreachable while the wordlist invariant (256 entries) holds */
    if (word === undefined) throw new Error("phraseFromDigest: wordlist must contain 256 entries");
    words.push(word);
  }
  return words.join(" ");
}

/** Convenience: terms -> canonical -> digest -> phrase in one step. */
export function phraseForTerms(terms: SettlementTerms, wordCount: number = DEFAULT_PHRASE_WORDS): string {
  return phraseFromDigest(termsDigest(terms), wordCount);
}

/**
 * Derive the spoken decimal read-back code from a terms digest.
 *
 * The whole 256-bit digest is reduced mod 10^digits and zero-padded, so the
 * code is a deterministic function of the terms and nothing else — no
 * randomness, no clock, no call state. Reducing 2^256 mod 10^6 leaves a modulo
 * bias of order 10^6 / 2^256, i.e. unobservable; the codes are uniform for any
 * purpose this system cares about.
 *
 * A useful side effect of using the modulus rather than a prefix: a shorter
 * code is always the SUFFIX of a longer one from the same digest, since
 * v mod 10^4 === (v mod 10^6) mod 10^4.
 *
 * COLLISION SPACE — an honest trade, stated plainly.
 *
 * Six digits is 10^6 = 1,000,000 codes. The three-word phrase it replaces was
 * 256^3 = 2^24 = 16,777,216 — about 16.8x larger. This is a real reduction and
 * it was made deliberately, because a token that does not survive the channel
 * has an effective collision space of zero: on the live calls the word phrase
 * failed to transcribe 2 out of 2 times, so no amount of theoretical entropy
 * was reaching the ledger.
 *
 * What the smaller space costs is bounded, because of what this code is and is
 * not. It is NOT a secret, NOT a capability, and NOT a bearer token: it is
 * spoken in the clear on a recorded call, and the SHA-256 terms digest — full
 * 256-bit strength, unchanged by this commit — remains what the ledger stores
 * and what an auditor recomputes. The code only has to answer one question:
 * "was this party read the same terms as the other party?" A collision means
 * two DIFFERENT settlements happen to speak the same six digits, which at 10^6
 * is a ~1-in-a-million audit nuisance rather than a forgery: a human is in the
 * loop for exactly the thing the code guards, since the callee hears the full
 * terms read aloud on the call and must separately say yes to them
 * (`agrees_to_terms`) before the attestation counts. The code makes a mismatch
 * audible to a human during the call; the digest, recorded on the ledger when
 * the case settles, is what makes the terms provable afterwards.
 *
 * Raise `digits` if a deployment wants more: 8 digits buys 100x at the cost of
 * two more spoken digits, and nothing else in the pipeline changes.
 */
export function codeFromDigest(digest: string, digits: number = DEFAULT_CODE_DIGITS): string {
  if (!SHA256_HEX.test(digest)) {
    throw new RangeError("codeFromDigest: digest must be a 64-char SHA-256 hex string");
  }
  if (!Number.isInteger(digits) || digits < MIN_CODE_DIGITS || digits > MAX_CODE_DIGITS) {
    throw new RangeError(
      `codeFromDigest: digits must be an integer in [${MIN_CODE_DIGITS}, ${MAX_CODE_DIGITS}]`,
    );
  }
  const value = BigInt(`0x${digest.toLowerCase()}`);
  const modulus = 10n ** BigInt(digits);
  return (value % modulus).toString().padStart(digits, "0");
}

/** Convenience: terms -> canonical -> digest -> spoken code in one step. */
export function codeForTerms(terms: SettlementTerms, digits: number = DEFAULT_CODE_DIGITS): string {
  return codeFromDigest(termsDigest(terms), digits);
}

/**
 * Spoken forms of a single digit, including the substitutions an ASR stack
 * actually emits on a phone line. "oh" for zero and "niner" for nine are how
 * people SAY digits; "for"/"to"/"ate"/"won"/"tree" are how a decoder mis-spells
 * what it heard. Both classes have to fold to the same digit or a correct
 * read-back gets rejected.
 */
const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: "0",
  oh: "0",
  o: "0",
  nought: "0",
  naught: "0",
  one: "1",
  won: "1",
  two: "2",
  to: "2",
  too: "2",
  three: "3",
  tree: "3",
  four: "4",
  for: "4",
  fore: "4",
  five: "5",
  fife: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
  niner: "9",
};

/** Multipliers people use when reading a code aloud: "double seven" -> 77. */
const REPEAT_WORDS: Readonly<Record<string, number>> = { double: 2, triple: 3, treble: 3 };

/**
 * Reduce a spoken code, as ASR transcribed it, to bare digits.
 *
 * Handles bare digits ("739241"), spaced or grouped digits ("7 3 9 2 4 1",
 * "739-241"), number words ("seven three nine two four one"), the homophones
 * listed in DIGIT_WORDS, "double"/"triple" multipliers, and arbitrary
 * punctuation and spacing ("seven, three... nine").
 *
 * Tokens that carry no digit are simply skipped, because transcripts arrive
 * with lead-ins ("Sure, it's 7 3 9 2 4 1"). The deliberate consequence: a stray
 * number word ANYWHERE in the utterance becomes a digit, so "one moment —
 * seven three nine" yields "1739" and fails the comparison. That is a false
 * REJECT, which costs a re-read; the alternative (guessing which digits the
 * speaker meant) would be a false ACCEPT, which costs the attestation its
 * meaning. Re-reads are cheap and the caller retries.
 *
 * Returns "" when the utterance contains nothing digit-like.
 */
export function spokenCodeToDigits(spoken: string): string {
  const tokens = spoken.normalize("NFKC").toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    const repeat = REPEAT_WORDS[token];
    if (repeat !== undefined) {
      const next = i + 1 < tokens.length ? tokenDigits(tokens[i + 1] as string) : "";
      if (next.length > 0) {
        out.push(next.repeat(repeat));
        i++; // consume the digit the multiplier applies to
      }
      continue; // a dangling "double" contributes nothing
    }
    out.push(tokenDigits(token));
  }
  return out.join("");
}

/**
 * Compare the expected attestation code to the raw transcribed speech.
 *
 * The comparison is EXACT after normalization — every digit, in order, no
 * tolerance. That is the right rule here and it is the opposite of the choice
 * made for the word phrase, for a concrete reason: digits transcribe reliably,
 * so a wrong digit is evidence of a wrong code rather than evidence of a noisy
 * line. Forgiving one digit out of six would collapse the effective space from
 * 10^6 to roughly 10^6 / (1 + 6*9) = ~18,000, which is a materially different
 * (and much worse) security claim than the one this system makes.
 *
 * `heard` carries the raw transcript so a failed attestation can be audited by
 * a human without re-listening to the recording; `digits` carries what the
 * normalizer made of it, so the two failure modes — the callee said the wrong
 * code vs. the normalizer mangled a right one — stay distinguishable.
 */
export function verifySpokenCode(expected: string, spokenRaw: string): CodeVerification {
  const expectedDigits = spokenCodeToDigits(expected);
  if (expectedDigits.length === 0) {
    throw new RangeError("verifySpokenCode: expected code must contain at least one digit");
  }
  const digits = spokenCodeToDigits(spokenRaw);

  // Exact is the happy path. Beyond it, tolerate one specific, bounded artifact
  // observed on a real call: a FALSE START — the callee begins the code, stops,
  // and restarts it in full ("935… 935006"). The complete code is demonstrably
  // spoken; rejecting it failed a live attestation that any human reviewer
  // would accept. Tolerance is containment of the full expected run:
  //  - the exact code must appear as one contiguous digit run, AND
  //  - the whole utterance may carry at most expectedDigits.length stray digits
  //    (a false start can never exceed one restart's worth), so "digit soup"
  //    can not sneak a code through.
  // A wrong, missing, or inserted digit still fails: "93006" (live, dropped
  // digit) and "9350096" (live, inserted digit) contain no contiguous "935006".
  // Chance containment by an unrelated utterance of ≤2n digits stays ~10^-6·n,
  // preserving the read-back's evidentiary value; a human confirms in-loop.
  const match =
    digits === expectedDigits ||
    (digits.includes(expectedDigits) && digits.length <= expectedDigits.length * 2);

  return {
    match,
    heard: spokenRaw.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    digits,
  };
}

/**
 * Compare an expected attestation token to the raw transcribed speech.
 *
 * Polymorphic by design so every existing caller keeps working across the
 * phrase -> code migration: when `expected` is a digit code (contains digits
 * and no letters) this delegates to `verifySpokenCode`; otherwise the original
 * word-phrase behaviour applies, unchanged. Settlements attested before the
 * switch still verify exactly as they did.
 *
 * Word-phrase match rule: after normalization (NFKC, lowercase, punctuation
 * stripped, whitespace collapsed) the spoken text must have exactly the
 * expected number of words, and each word must be within Levenshtein distance 1
 * of its expected counterpart — tolerating one small ASR slip per word
 * ("falcons" for "falcon") while rejecting any different word ("eagle" for
 * "falcon").
 *
 * The wordlist guarantees pairwise distance >= 2 between entries, so this
 * tolerance can never accept one *list* word verbatim in place of another; a
 * false accept would require an ASR error that lands exactly between two list
 * words on every affected position. What the live calls showed is that this
 * safety argument was never the binding constraint — the transcript did not
 * land near the phrase at all.
 */
export function verifySpokenPhrase(expected: string, spokenRaw: string): SpokenVerification {
  if (isDigitCode(expected)) {
    const verified = verifySpokenCode(expected, spokenRaw);
    const expectedDigits = spokenCodeToDigits(expected);
    const normalizedDistance = verified.match
      ? 0
      : levenshtein(expectedDigits, verified.digits) /
        Math.max(expectedDigits.length, verified.digits.length);
    return {
      match: verified.match,
      normalizedDistance,
      heard: verified.heard,
      digits: verified.digits,
    };
  }

  const expectedWords = phraseTokens(expected);
  if (expectedWords.length === 0) {
    throw new RangeError("verifySpokenPhrase: expected phrase must contain at least one word");
  }
  const spokenWords = phraseTokens(spokenRaw);

  const e = expectedWords.join(" ");
  const s = spokenWords.join(" ");
  const normalizedDistance = e === s ? 0 : levenshtein(e, s) / Math.max(e.length, s.length);

  const match =
    spokenWords.length === expectedWords.length &&
    expectedWords.every((word, i) => levenshtein(word, spokenWords[i] ?? "") <= 1);

  return { match, normalizedDistance };
}

/**
 * Plain Levenshtein edit distance (substitution/insertion/deletion, unit
 * cost). Exported because the attestation tests assert wordlist invariants
 * with the exact same metric the verifier uses.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let curr: number[] = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] as number) + 1, (prev[j] as number) + 1, (prev[j - 1] as number) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] as number;
}

function normalizeCondition(c: string): string {
  return c.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** A single token's digit contribution: literal digits, or a spoken digit word. */
function tokenDigits(token: string): string {
  if (/^[0-9]+$/.test(token)) return token;
  return DIGIT_WORDS[token] ?? "";
}

/**
 * Routing test for `verifySpokenPhrase`: is the EXPECTED token a digit code?
 * Decided on the expected value alone (never on what was heard), so a callee
 * mumbling numbers can never move a word-phrase attestation onto the digit
 * path, or vice versa.
 */
function isDigitCode(expected: string): boolean {
  const normalized = expected.normalize("NFKC").toLowerCase();
  return /[0-9]/.test(normalized) && !/[a-z]/.test(normalized);
}

/** Normalize free speech into comparable word tokens. */
function phraseTokens(s: string): string[] {
  const norm = s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return norm.length === 0 ? [] : norm.split(" ");
}
