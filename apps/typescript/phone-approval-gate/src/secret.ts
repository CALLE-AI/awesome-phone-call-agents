/**
 * One-time approval secrets.
 *
 * Two bindings are supported and they defend against different things.
 *
 * `code_from_request` generates a six digit code with the platform CSPRNG. The
 * code is printed in the request channel (the CI log, the agent output, the
 * change ticket) and never spoken by the caller, so reading it back shows the
 * person can see the request they are approving. Guessing resistance matters
 * here, so the length and the single use rule follow the out-of-band
 * authenticator rules in NIST SP 800-63B: at least six decimal digits from an
 * approved generator, accepted once and invalid after the validity window.
 *
 * `liveness_phrase` generates three words that CALL-E reads out loud and the
 * person repeats. The phrase is not secret, so entropy buys nothing against an
 * attacker. It only proves a live person is on the line, which is what stops a
 * recorded "yes", a voicemail greeting or an IVR menu from ever counting as an
 * approval. Use it when the approver has no screen.
 */

import { createHash, randomInt } from "node:crypto";

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

/** Remove the secret from text before it is written to an audit record. */
export function redactSecret(text: string, secret: string, phrase: string[]): string {
  let output = text;
  const digitRuns = output.match(/\d[\d\s-]*\d|\d/g) ?? [];
  for (const run of digitRuns) {
    if (spokenDigits(run).includes(secret)) {
      output = output.replace(run, "[code]");
    }
  }
  const spelled = new RegExp(
    `(?:\\b(?:${Object.keys(DIGIT_WORDS).join("|")})\\b[\\s,-]*){${CODE_DIGITS},}`,
    "gi",
  );
  output = output.replace(spelled, (match) =>
    spokenDigits(match).includes(secret) ? "[code]" : match,
  );
  for (const word of phrase) {
    output = output.replace(new RegExp(`\\b${word}\\b`, "gi"), "[phrase]");
  }
  return output;
}
