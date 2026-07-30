/**
 * One-time approval secrets.
 *
 * Two bindings are supported and they defend against different things.
 *
 * `code_from_request` generates a six digit code. The code is printed in the
 * request channel (the CI log, the agent output, the change ticket) and never
 * spoken by the caller, so reading it back shows the person can see the request
 * they are approving. Guessing resistance matters here, so the length and the
 * single use rule follow the out-of-band authenticator rules in NIST SP 800-63B:
 * at least six decimal digits from an approved generator, accepted once and
 * invalid after the validity window.
 *
 * `liveness_phrase` generates three words that CALL-E reads out loud and the
 * person repeats. The phrase is not secret, so entropy buys nothing against an
 * attacker. It only proves a live person is on the line, which is what stops a
 * recorded "yes", a voicemail greeting or an IVR menu from ever counting as an
 * approval. Use it when the approver has no screen.
 *
 * A secret comes from one of two generators. `deriveSecret` computes it from
 * operator key material and the request, so two runners of one request derive
 * the same code with nothing shared but the key. `generateCode` draws a fresh
 * one from the platform CSPRNG, which is what a single run with no key material
 * and the local demo use.
 */

import { createHash, createHmac, randomInt } from "node:crypto";

export const CODE_DIGITS = 6;
export const PHRASE_LENGTH = 3;

/**
 * Spoken-digit homophones accepted when reading a code back. Each entry widens
 * what a person can say. It also widens what a guesser can hit, which is why
 * the list stays short and explicit rather than clever.
 */
const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  nought: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  for: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  ate: "8",
  nine: "9",
  niner: "9",
};

/**
 * Short words that survive a phone line. No homophone pairs, no words that
 * sound like a decision word, nothing that changes meaning if misheard.
 */
const PHRASE_WORDS = [
  "anchor", "apple", "atlas", "author", "bamboo", "basket", "beacon", "bishop",
  "bridge", "bronze", "burlap", "cactus", "candle", "canvas", "carbon", "cargo",
  "castle", "cedar", "cement", "chapel", "cherry", "chisel", "cinder", "circus",
  "citrus", "clover", "cobalt", "comet", "copper", "coral", "cotton", "crater",
  "crayon", "cricket", "crimson", "crystal", "cypress", "dahlia", "denim", "diesel",
  "dolphin", "domino", "dragon", "ebony", "eclipse", "elder", "ember", "emerald",
  "engine", "fabric", "falcon", "fennel", "ferry", "fiddle", "flannel", "flint",
  "forest", "fossil", "fountain", "galaxy", "garnet", "gazebo", "ginger", "glacier",
  "granite", "gravel", "gumbo", "hammer", "harbor", "harvest", "hazel", "helmet",
  "hickory", "hollow", "hornet", "indigo", "ivory", "jasmine", "jigsaw", "juniper",
  "kettle", "lantern", "lattice", "lava", "ledger", "lemon", "lentil", "lilac",
  "linen", "lobster", "locket", "lumber", "magnet", "mahogany", "mallet", "mango",
  "maple", "marble", "meadow", "medal", "mercury", "mineral", "mitten", "monsoon",
  "mosaic", "muffin", "mustard", "nectar", "nickel", "nutmeg", "oatmeal", "olive",
  "orchid", "otter", "oxide", "paddle", "pantry", "papaya", "parsley", "pebble",
  "pelican", "pepper", "pewter", "pigment", "pistol", "pivot", "plaster", "platinum",
] as const;

export function generateCode(): string {
  let code = "";
  for (let index = 0; index < CODE_DIGITS; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

export function generatePhrase(): string[] {
  const words: string[] = [];
  while (words.length < PHRASE_LENGTH) {
    const word = PHRASE_WORDS[randomInt(0, PHRASE_WORDS.length)];
    if (!words.includes(word)) {
      words.push(word);
    }
  }
  return words;
}

/** Guessing resistance of the code, expressed the way NIST SP 800-63B does. */
export function codeDecimalDigits(): number {
  return CODE_DIGITS;
}

/** Shortest key material `deriveSecret` accepts, from RFC 4226 section 4: 128 bits. */
export const CODE_KEY_MIN_BYTES = 16;

/** Everything a derived secret is bound to. Every field is shared by every runner. */
export interface SecretContext {
  /** Digest of the content that decides what this call says. */
  requestDigest: string;
  approverId: string;
  attempt: number;
}

function mac(key: Buffer, label: string, context: SecretContext, counter: number): Buffer {
  // Newline separated. No field can hold a newline: the digest is hex, the
  // approver id is validated to letters, digits, dot, dash and underscore and
  // the rest are numbers. So one context cannot be spelled two ways.
  return createHmac("sha256", key)
    .update(
      `${label}\n${context.requestDigest}\n${context.approverId}\n${context.attempt}\n${counter}`,
    )
    .digest();
}

/**
 * Derive the secret for one attempt from operator key material.
 *
 * Coordinating a random code across runners needs shared state. Deriving it does
 * not: every runner holding the same key and looking at the same request gets the
 * same code, so there is no race to lose and no runner ends up checking a call
 * against a code the approver was never shown. The window start is deliberately
 * not an input, because it is per run.
 *
 * The digits come out the way RFC 4226 section 5.3 takes an HOTP value out of a
 * MAC: the low four bits of the last byte pick an offset, four bytes are read
 * there, the top bit is masked off to keep the value unsigned and the result is
 * reduced modulo ten to the number of digits. HMAC-SHA-256 stands in for
 * HMAC-SHA-1. The phrase words are picked from the same MAC by rejection
 * sampling, so the pick stays uniform whatever the word list length is.
 */
export function deriveSecret(key: Buffer, context: SecretContext): { code: string; phrase: string[] } {
  if (key.length < CODE_KEY_MIN_BYTES) {
    throw new Error(
      `Approval code key material must be at least ${CODE_KEY_MIN_BYTES} bytes (128 bits), the floor RFC 4226 sets for a shared secret. Received ${key.length}.`,
    );
  }
  const digits = mac(key, "phone-approval-gate/code/v1", context, 0);
  const offset = digits[digits.length - 1]! & 0x0f;
  const truncated =
    ((digits[offset]! & 0x7f) << 24) |
    (digits[offset + 1]! << 16) |
    (digits[offset + 2]! << 8) |
    digits[offset + 3]!;
  const code = String(truncated % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, "0");

  const words: string[] = [];
  const ceiling = 256 - (256 % PHRASE_WORDS.length);
  for (let counter = 0; words.length < PHRASE_LENGTH; counter += 1) {
    for (const byte of mac(key, "phone-approval-gate/phrase/v1", context, counter)) {
      if (byte >= ceiling) {
        continue; // Would bias the pick, so it is thrown away.
      }
      const word = PHRASE_WORDS[byte % PHRASE_WORDS.length]!;
      if (!words.includes(word)) {
        words.push(word);
      }
      if (words.length === PHRASE_LENGTH) {
        break;
      }
    }
  }
  return { code, phrase: words };
}

/** Bits in a phrase. Reported for the record, not relied on for security. */
export function phraseEntropyBits(): number {
  return Math.round(PHRASE_LENGTH * Math.log2(PHRASE_WORDS.length) * 10) / 10;
}

/** Read a code aloud one digit at a time. "472913" becomes "4 7 2 9 1 3". */
export function spokenCode(code: string): string {
  return code.split("").join(" ");
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);
}

/** Collapse a spoken line into the digits it contains, homophones included. */
export function spokenDigits(text: string): string {
  let digits = "";
  for (const word of words(text)) {
    if (/^\d+$/.test(word)) {
      digits += word;
      continue;
    }
    const mapped = DIGIT_WORDS[word];
    if (mapped !== undefined) {
      digits += mapped;
    }
  }
  return digits;
}

export function containsCode(text: string, code: string): boolean {
  return spokenDigits(text).includes(code);
}

/** True when the phrase words appear in order in the line. */
export function containsPhrase(text: string, phrase: string[]): boolean {
  const spoken = words(text);
  let index = 0;
  for (const word of spoken) {
    if (word === phrase[index]) {
      index += 1;
      if (index === phrase.length) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Digest used to bind a record to a secret without storing the secret. The
 * request id is mixed in so digests cannot be compared across requests. The
 * secret is single use and expires with the window, so this digest is a binding
 * aid and not a place to hide a long-lived value.
 */
export function secretDigest(requestId: string, secret: string): string {
  return `sha256:${createHash("sha256").update(`${requestId}:${secret}`).digest("hex")}`;
}

/**
 * Remove the secret from text before it is written to an audit record.
 *
 * A code that is not this run's is removed as well. It belongs to another run of
 * this request or to another request entirely, it is still live for whoever holds
 * it and an approval record is not the place to publish it.
 */
export function redactSecret(text: string, secret: string, phrase: string[]): string {
  const marker = (spoken: string): string | null => {
    if (spoken.includes(secret)) {
      return "[code]";
    }
    return spoken.length >= CODE_DIGITS ? "[digits]" : null;
  };
  let output = text;
  const digitRuns = output.match(/\d[\d\s-]*\d|\d/g) ?? [];
  for (const run of digitRuns) {
    const replacement = marker(spokenDigits(run));
    if (replacement !== null) {
      output = output.replace(run, replacement);
    }
  }
  const digitWords = Object.keys(DIGIT_WORDS).join("|");
  // Spelled out, with the separators between the words rather than after them,
  // so the marker cannot swallow the word that follows the last digit.
  const spelled = new RegExp(
    `\\b(?:${digitWords})\\b(?:[\\s,-]+\\b(?:${digitWords})\\b){${CODE_DIGITS - 1},}`,
    "gi",
  );
  output = output.replace(spelled, (match) => marker(spokenDigits(match)) ?? match);
  for (const word of phrase) {
    output = output.replace(new RegExp(`\\b${word}\\b`, "gi"), "[phrase]");
  }
  return output;
}
