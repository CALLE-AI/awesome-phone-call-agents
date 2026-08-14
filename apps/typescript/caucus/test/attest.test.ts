/**
 * Dual-attestation tests: canonical terms → digest → spoken token → verification.
 *
 * Two claims carry the design and both are checked mechanically here:
 *  - the spoken token is a fingerprint of the exact terms (different terms,
 *    even by one cent, produce a different token), and
 *  - the token survives a phone line.
 *
 * The second claim is where reality intervened. The word-phrase encoding
 * satisfies it in theory — one ASR slip per word is forgiven, and no word of
 * the list can ever be verified in place of another because the list keeps
 * every pair at Levenshtein distance >= 2 — but on four live calls it failed
 * outright, twice out of two attempts. Both real transcripts are pinned as
 * regression tests below. The digit-code encoding that replaced it is tested
 * alongside, and the word-phrase coverage is kept in full: those functions
 * still ship, and the properties they were built on are still true.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  canonicalTerms,
  codeForTerms,
  codeFromDigest,
  levenshtein,
  phraseForTerms,
  phraseFromDigest,
  spokenCodeToDigits,
  termsDigest,
  verifySpokenCode,
  verifySpokenPhrase,
  type SettlementTerms,
} from "../src/attest.js";
import { WORDS } from "../src/wordlist.js";

const HEX64 = /^[0-9a-f]{64}$/;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// canonicalTerms
// ---------------------------------------------------------------------------

describe("canonicalTerms", () => {
  it("emits a fixed key order: amountCents then conditions", () => {
    expect(canonicalTerms({ amountCents: 84_000, conditions: ["b", "a"] })).toBe(
      '{"amountCents":84000,"conditions":["a","b"]}',
    );
  });

  it("sorts conditions by UTF-16 code units, not by locale collation", () => {
    // Locale-aware collation would place "Ápple" next to "apple"; code-unit
    // ordering (the implementation's rule) puts uppercase first and "Á" last.
    const canonical = canonicalTerms({
      amountCents: 1,
      conditions: ["apple", "Zebra", "Ápple"],
    });
    expect(canonical).toBe('{"amountCents":1,"conditions":["Zebra","apple","Ápple"]}');
  });

  it("is invariant to the order conditions arrive in", () => {
    const a = canonicalTerms({ amountCents: 50_000, conditions: ["key", "carpet", "remote"] });
    const b = canonicalTerms({ amountCents: 50_000, conditions: ["remote", "key", "carpet"] });
    expect(b).toBe(a);
  });

  it("property: any permutation of the same conditions canonicalizes identically", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0), {
          maxLength: 6,
        }),
        (amountCents, conditions) => {
          const shuffled = [...conditions].reverse();
          expect(canonicalTerms({ amountCents, conditions: shuffled })).toBe(
            canonicalTerms({ amountCents, conditions }),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("collapses incidental whitespace and trims each condition", () => {
    expect(
      canonicalTerms({ amountCents: 1, conditions: ["  Tenant   returns\tthe\nmailbox key  "] }),
    ).toBe('{"amountCents":1,"conditions":["Tenant returns the mailbox key"]}');
  });

  it("drops empty/whitespace-only conditions and dedupes the rest", () => {
    expect(
      canonicalTerms({
        amountCents: 1,
        conditions: ["key", "key ", " key", "", "   ", "\t\n"],
      }),
    ).toBe('{"amountCents":1,"conditions":["key"]}');
  });

  it("treats NFC-equivalent conditions as the same condition", () => {
    const composed = "café access restored"; // é as U+00E9
    const decomposed = "café access restored"; // e + combining acute
    expect(composed).not.toBe(decomposed);
    const canonical = canonicalTerms({ amountCents: 1, conditions: [composed, decomposed] });
    expect(JSON.parse(canonical)).toEqual({ amountCents: 1, conditions: [composed.normalize("NFC")] });
  });

  it("accepts a zero amount but rejects anything not a non-negative safe integer", () => {
    expect(canonicalTerms({ amountCents: 0, conditions: [] })).toBe(
      '{"amountCents":0,"conditions":[]}',
    );
    for (const bad of [-1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => canonicalTerms({ amountCents: bad, conditions: [] })).toThrow(RangeError);
    }
  });
});

// ---------------------------------------------------------------------------
// termsDigest
// ---------------------------------------------------------------------------

describe("termsDigest", () => {
  const terms: SettlementTerms = {
    amountCents: 84_000,
    conditions: ["Tenant returns the mailbox key by Friday"],
  };

  it("is exactly SHA-256 over the canonical JSON", () => {
    expect(termsDigest(terms)).toBe(sha256Hex(canonicalTerms(terms)));
    expect(termsDigest(terms)).toMatch(HEX64);
  });

  it("is deterministic across calls", () => {
    expect(termsDigest(terms)).toBe(termsDigest({ ...terms, conditions: [...terms.conditions] }));
  });

  it("ignores condition order and incidental whitespace", () => {
    const a = termsDigest({ amountCents: 700, conditions: ["carpet clean", "key returned"] });
    const b = termsDigest({ amountCents: 700, conditions: ["key   returned ", " carpet clean"] });
    expect(b).toBe(a);
  });

  it("changes when the amount changes by a single cent", () => {
    expect(termsDigest({ ...terms, amountCents: 84_001 })).not.toBe(termsDigest(terms));
  });

  it("changes when a condition is added, removed, or edited", () => {
    const base = termsDigest(terms);
    expect(termsDigest({ ...terms, conditions: [] })).not.toBe(base);
    expect(termsDigest({ ...terms, conditions: [...terms.conditions, "extra"] })).not.toBe(base);
    expect(termsDigest({ ...terms, conditions: ["Tenant returns the mailbox key by Monday"] })).not.toBe(
      base,
    );
  });
});

// ---------------------------------------------------------------------------
// phraseFromDigest / phraseForTerms
// ---------------------------------------------------------------------------

describe("phraseFromDigest", () => {
  const digest = sha256Hex("caucus fixture");

  it("maps one leading digest byte to one wordlist entry, in order", () => {
    const crafted = `0001ff${"0".repeat(58)}`;
    expect(crafted).toMatch(HEX64);
    expect(phraseFromDigest(crafted)).toBe(`${WORDS[0]} ${WORDS[1]} ${WORDS[255]}`);
    // General case: recomputed independently from the digest bytes.
    const expected = [0, 1, 2]
      .map((i) => WORDS[Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16)])
      .join(" ");
    expect(phraseFromDigest(digest)).toBe(expected);
  });

  it("is deterministic and defaults to three words", () => {
    expect(phraseFromDigest(digest)).toBe(phraseFromDigest(digest));
    expect(phraseFromDigest(digest).split(" ")).toHaveLength(3);
  });

  it("honours an explicit word count at both ends of the allowed range", () => {
    expect(phraseFromDigest(digest, 1).split(" ")).toHaveLength(1);
    expect(phraseFromDigest(digest, 32).split(" ")).toHaveLength(32);
    // A shorter phrase is always a prefix of a longer one from the same digest.
    expect(phraseFromDigest(digest, 8).startsWith(phraseFromDigest(digest, 3))).toBe(true);
  });

  it("accepts an upper-case digest and yields the same phrase", () => {
    expect(phraseFromDigest(digest.toUpperCase())).toBe(phraseFromDigest(digest));
  });

  it("only ever emits words from the curated list", () => {
    const listed = new Set(WORDS);
    for (const word of phraseFromDigest(digest, 32).split(" ")) {
      expect(listed.has(word)).toBe(true);
    }
  });

  it("rejects malformed digests", () => {
    for (const bad of ["", digest.slice(0, 63), `${digest}0`, `${"z".repeat(64)}`, "not-a-digest"]) {
      expect(() => phraseFromDigest(bad)).toThrow(RangeError);
    }
  });

  it("rejects out-of-range or non-integer word counts", () => {
    for (const bad of [0, -1, 33, 2.5, Number.NaN]) {
      expect(() => phraseFromDigest(digest, bad)).toThrow(RangeError);
    }
  });
});

describe("phraseForTerms", () => {
  const terms: SettlementTerms = { amountCents: 84_000, conditions: ["Key returned"] };

  it("composes canonicalize → digest → phrase", () => {
    expect(phraseForTerms(terms)).toBe(phraseFromDigest(termsDigest(terms)));
    expect(phraseForTerms(terms, 5)).toBe(phraseFromDigest(termsDigest(terms), 5));
  });

  it("gives both parties the same phrase for the same terms, whatever order they arrived in", () => {
    const partyA = phraseForTerms({ amountCents: 84_000, conditions: ["Key returned", "Carpet cleaned"] });
    const partyB = phraseForTerms({ amountCents: 84_000, conditions: ["Carpet cleaned", "Key   returned"] });
    expect(partyB).toBe(partyA);
  });

  it("a one-cent difference in terms changes the phrase (200-amount sweep)", () => {
    const phrases: string[] = [];
    for (let cents = 100_000; cents < 100_200; cents++) {
      phrases.push(phraseForTerms({ amountCents: cents, conditions: ["Tenant returns the mailbox key"] }));
    }
    expect(phrases).toHaveLength(200);
    // Every consecutive pair differs...
    for (let i = 1; i < phrases.length; i++) {
      expect(phrases[i]).not.toBe(phrases[i - 1]);
    }
    // ...and across the whole sweep there is not a single repeat.
    expect(new Set(phrases).size).toBe(200);
  });

  it("a one-condition difference changes the phrase", () => {
    const withKey = phraseForTerms({ amountCents: 84_000, conditions: ["Key returned"] });
    const withoutKey = phraseForTerms({ amountCents: 84_000, conditions: [] });
    expect(withoutKey).not.toBe(withKey);
  });
});

// ---------------------------------------------------------------------------
// codeFromDigest / codeForTerms — the encoding attestation calls actually speak
// ---------------------------------------------------------------------------

describe("codeFromDigest", () => {
  const digest = sha256Hex("caucus fixture");

  it("is the whole digest reduced mod 10^digits, zero-padded", () => {
    // Recomputed independently of the implementation's arithmetic.
    const expected = (BigInt(`0x${digest}`) % 1_000_000n).toString().padStart(6, "0");
    expect(codeFromDigest(digest)).toBe(expected);
    expect(codeFromDigest(digest)).toBe("624003");
  });

  it("is deterministic and defaults to six digits", () => {
    expect(codeFromDigest(digest)).toBe(codeFromDigest(digest));
    expect(codeFromDigest(digest)).toMatch(/^[0-9]{6}$/);
  });

  it("pads a short remainder with leading zeros rather than shortening the code", () => {
    // A code that loses its leading zeros stops being a fixed-width read-back:
    // "903" and "000903" would have to be treated as the same code, and every
    // caller would need to know which one to expect.
    const leadingZeros = "78d7b19a915324447f82ec0130f6a8900f2d1dd2547b49e00be30d163caea947";
    expect(BigInt(`0x${leadingZeros}`) % 1_000_000n).toBe(903n);
    expect(codeFromDigest(leadingZeros)).toBe("000903");
    expect(codeFromDigest("0".repeat(64))).toBe("000000");
    expect(codeFromDigest(leadingZeros, 12)).toHaveLength(12);
  });

  it("honours an explicit digit count at both ends of the allowed range", () => {
    expect(codeFromDigest(digest, 4)).toHaveLength(4);
    expect(codeFromDigest(digest, 12)).toHaveLength(12);
  });

  it("makes a shorter code the SUFFIX of a longer one from the same digest", () => {
    // v mod 10^4 === (v mod 10^6) mod 10^4. Worth pinning: it is the mirror of
    // the phrase rule (a shorter phrase is a PREFIX of a longer one), so anyone
    // reasoning from the word encoding does not guess wrong here.
    const six = codeFromDigest(digest, 6);
    expect(codeFromDigest(digest, 4)).toBe(six.slice(-4));
    expect(codeFromDigest(digest, 8).endsWith(six)).toBe(true);
  });

  it("accepts an upper-case digest and yields the same code", () => {
    expect(codeFromDigest(digest.toUpperCase())).toBe(codeFromDigest(digest));
  });

  it("emits nothing but ASCII digits, for every digit count", () => {
    for (let d = 4; d <= 12; d++) {
      expect(codeFromDigest(digest, d)).toMatch(new RegExp(`^[0-9]{${d}}$`));
    }
  });

  it("rejects malformed digests", () => {
    for (const bad of ["", digest.slice(0, 63), `${digest}0`, "z".repeat(64), "not-a-digest"]) {
      expect(() => codeFromDigest(bad)).toThrow(RangeError);
    }
  });

  it("rejects out-of-range or non-integer digit counts", () => {
    // Below 4 the code is too weak to be worth speaking; above 12 nobody reads
    // it back correctly. Both ends are refused rather than silently clamped.
    for (const bad of [0, -1, 3, 13, 6.5, Number.NaN]) {
      expect(() => codeFromDigest(digest, bad)).toThrow(RangeError);
    }
  });
});

describe("codeForTerms", () => {
  const terms: SettlementTerms = { amountCents: 84_000, conditions: ["Key returned"] };

  it("composes canonicalize → digest → code", () => {
    expect(codeForTerms(terms)).toBe(codeFromDigest(termsDigest(terms)));
    expect(codeForTerms(terms, 8)).toBe(codeFromDigest(termsDigest(terms), 8));
  });

  it("gives both parties the same code for the same terms, whatever order they arrived in", () => {
    const partyA = codeForTerms({ amountCents: 84_000, conditions: ["Key returned", "Carpet cleaned"] });
    const partyB = codeForTerms({ amountCents: 84_000, conditions: ["Carpet cleaned", "Key   returned"] });
    expect(partyB).toBe(partyA);
  });

  it("a one-cent difference in terms changes the code (200-amount sweep)", () => {
    const codes: string[] = [];
    for (let cents = 100_000; cents < 100_200; cents++) {
      codes.push(codeForTerms({ amountCents: cents, conditions: ["Tenant returns the mailbox key"] }));
    }
    expect(codes).toHaveLength(200);
    for (let i = 1; i < codes.length; i++) {
      expect(codes[i]).not.toBe(codes[i - 1]);
    }
    // Measured over this exact sweep: 200 distinct codes, no repeat anywhere.
    expect(new Set(codes).size).toBe(200);
  });

  it("a one-condition difference changes the code", () => {
    const withKey = codeForTerms({ amountCents: 84_000, conditions: ["Key returned"] });
    const withoutKey = codeForTerms({ amountCents: 84_000, conditions: [] });
    expect(withoutKey).not.toBe(withKey);
  });
});

// ---------------------------------------------------------------------------
// Wordlist integrity — the phonetics floor the verifier depends on
// ---------------------------------------------------------------------------

describe("WORDS integrity", () => {
  it("has exactly 256 entries so one digest byte selects one word", () => {
    expect(WORDS).toHaveLength(256);
  });

  it("has no duplicates", () => {
    expect(new Set(WORDS).size).toBe(256);
  });

  it("is entirely lowercase ASCII letters, 4-8 characters long", () => {
    const offenders = WORDS.filter((w) => !/^[a-z]{4,8}$/.test(w));
    expect(offenders).toEqual([]);
  });

  it("keeps EVERY pair at Levenshtein distance >= 2 (verification tolerates 1)", () => {
    const tooClose: string[] = [];
    for (let i = 0; i < WORDS.length; i++) {
      for (let j = i + 1; j < WORDS.length; j++) {
        const a = WORDS[i] as string;
        const b = WORDS[j] as string;
        if (levenshtein(a, b) <= 1) tooClose.push(`${a}/${b}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  it("keeps mechanical rhyme pairs (same final three letters) at distance >= 3", () => {
    const rhymesTooClose: string[] = [];
    for (let i = 0; i < WORDS.length; i++) {
      for (let j = i + 1; j < WORDS.length; j++) {
        const a = WORDS[i] as string;
        const b = WORDS[j] as string;
        if (a.slice(-3) === b.slice(-3) && levenshtein(a, b) < 3) rhymesTooClose.push(`${a}/${b}`);
      }
    }
    expect(rhymesTooClose).toEqual([]);
  });

  it("contains no number words (phrases are spoken alongside dollar amounts)", () => {
    const numbers = new Set([
      "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
      "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
      "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
      "hundred", "thousand", "million", "billion", "dozen", "half", "quarter",
    ]);
    expect(WORDS.filter((w) => numbers.has(w))).toEqual([]);
  });
});

describe("levenshtein", () => {
  it("computes the standard edit distance", () => {
    expect(levenshtein("falcon", "falcon")).toBe(0);
    expect(levenshtein("falcon", "falcons")).toBe(1); // insertion
    expect(levenshtein("falcon", "falco")).toBe(1); // deletion
    expect(levenshtein("falcon", "falson")).toBe(1); // substitution
    expect(levenshtein("falcon", "eagle")).toBe(5);
    expect(levenshtein("", "amber")).toBe(5);
    expect(levenshtein("amber", "")).toBe(5);
  });

  it("is symmetric and satisfies the triangle inequality on wordlist samples", () => {
    for (let i = 0; i < 40; i++) {
      const a = WORDS[(i * 7) % 256] as string;
      const b = WORDS[(i * 13 + 5) % 256] as string;
      const c = WORDS[(i * 29 + 11) % 256] as string;
      expect(levenshtein(a, b)).toBe(levenshtein(b, a));
      expect(levenshtein(a, c)).toBeLessThanOrEqual(levenshtein(a, b) + levenshtein(b, c));
    }
  });
});

// ---------------------------------------------------------------------------
// verifySpokenPhrase
// ---------------------------------------------------------------------------

describe("verifySpokenPhrase", () => {
  const expected = "amber falcon marble";

  it("accepts the phrase repeated verbatim, with distance 0", () => {
    const result = verifySpokenPhrase(expected, expected);
    expect(result.match).toBe(true);
    expect(result.normalizedDistance).toBe(0);
  });

  it("ignores case, punctuation and whitespace as ASR renders them", () => {
    for (const spoken of [
      "Amber, falcon marble.",
      "AMBER FALCON MARBLE",
      "  amber\n falcon\t  marble  ",
      "amber-falcon-marble",
      "amber... falcon; marble!",
      "ａｍｂｅｒ falcon marble", // fullwidth "amber" → NFKC
    ]) {
      const result = verifySpokenPhrase(expected, spoken);
      expect(result.match).toBe(true);
      expect(result.normalizedDistance).toBe(0);
    }
  });

  it("tolerates a single-character ASR slip in one word", () => {
    const result = verifySpokenPhrase(expected, "amber falcons marble");
    expect(result.match).toBe(true);
    expect(result.normalizedDistance).toBeGreaterThan(0);
    expect(result.normalizedDistance).toBeLessThan(0.1);
  });

  it("tolerates one slip in every word simultaneously", () => {
    expect(verifySpokenPhrase(expected, "ambers falcons marbles").match).toBe(true); // 3 insertions
    expect(verifySpokenPhrase(expected, "amper falcom marbles").match).toBe(true); // 2 subs + 1 insertion
  });

  it("rejects a transposition — the metric is plain Levenshtein, not Damerau", () => {
    // "marbel" is one swap away but two edits away; the verifier errs strict.
    expect(levenshtein("marble", "marbel")).toBe(2);
    expect(verifySpokenPhrase(expected, "amber falcon marbel").match).toBe(false);
  });

  it("rejects two slips inside a single word", () => {
    expect(verifySpokenPhrase(expected, "amber falconsy marble").match).toBe(false);
    expect(verifySpokenPhrase(expected, "ambr falcon marble").match).toBe(true); // one deletion: still fine
    expect(verifySpokenPhrase(expected, "abr falcon marble").match).toBe(false); // two: rejected
  });

  it("rejects a genuinely different word", () => {
    const result = verifySpokenPhrase(expected, "amber eagle marble");
    expect(result.match).toBe(false);
    expect(result.normalizedDistance).toBeGreaterThan(0);
  });

  it("rejects the right words in the wrong order", () => {
    expect(verifySpokenPhrase(expected, "falcon amber marble").match).toBe(false);
    expect(verifySpokenPhrase(expected, "marble falcon amber").match).toBe(false);
  });

  it("rejects a missing or an extra word", () => {
    expect(verifySpokenPhrase(expected, "amber marble").match).toBe(false);
    expect(verifySpokenPhrase(expected, "amber falcon").match).toBe(false);
    expect(verifySpokenPhrase(expected, "amber falcon marble please").match).toBe(false);
    expect(verifySpokenPhrase(expected, "okay amber falcon marble").match).toBe(false);
  });

  it("rejects silence and reports a fully-mismatched distance", () => {
    const result = verifySpokenPhrase(expected, "   ...   ");
    expect(result.match).toBe(false);
    expect(result.normalizedDistance).toBe(1);
  });

  it("reports a near-1 distance for an unrelated utterance", () => {
    const result = verifySpokenPhrase(expected, "sorry could you repeat that");
    expect(result.match).toBe(false);
    expect(result.normalizedDistance).toBeGreaterThan(0.5);
  });

  it("throws when the expected phrase itself is empty", () => {
    expect(() => verifySpokenPhrase("", "amber falcon marble")).toThrow(RangeError);
    expect(() => verifySpokenPhrase("   ,.!  ", "amber falcon marble")).toThrow(RangeError);
  });

  it("can never verify one wordlist entry in place of another (full sweep)", () => {
    // The distance-1 tolerance is safe only because the list has no distance-1
    // neighbours: substituting ANY other list word must fail, for every word.
    let checked = 0;
    for (let i = 0; i < WORDS.length; i++) {
      const word = WORDS[i] as string;
      for (let j = 0; j < WORDS.length; j++) {
        if (i === j) continue;
        const impostor = WORDS[j] as string;
        expect(verifySpokenPhrase(word, impostor).match).toBe(false);
        checked++;
      }
    }
    expect(checked).toBe(256 * 255);
  });

  it("verifies a real settlement phrase end to end", () => {
    const terms: SettlementTerms = {
      amountCents: 84_000,
      conditions: ["Tenant returns the mailbox key by Friday"],
    };
    const phrase = phraseForTerms(terms);
    // What the callee said, as a transcript would carry it.
    expect(verifySpokenPhrase(phrase, `${phrase.replace(/ /g, ", ")}.`).match).toBe(true);
    // The phrase for one-cent-different terms must not verify against these terms.
    const otherPhrase = phraseForTerms({ ...terms, amountCents: 84_001 });
    expect(verifySpokenPhrase(phrase, otherPhrase).match).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// spokenCodeToDigits — every shape a transcribed code arrives in
// ---------------------------------------------------------------------------

describe("spokenCodeToDigits", () => {
  it("passes bare digits through unchanged", () => {
    expect(spokenCodeToDigits("739241")).toBe("739241");
  });

  it("collapses spaced, grouped and punctuated digits", () => {
    for (const spoken of [
      "7 3 9 2 4 1",
      "739 241",
      "73-92-41",
      "7.3.9.2.4.1",
      "  739241  ",
      "739,241.",
      "739241!",
    ]) {
      expect(spokenCodeToDigits(spoken)).toBe("739241");
    }
  });

  it("reads number words", () => {
    expect(spokenCodeToDigits("seven three nine two four one")).toBe("739241");
    expect(spokenCodeToDigits("Seven Three Nine Two Four One")).toBe("739241");
    expect(spokenCodeToDigits("zero five six eight")).toBe("0568");
  });

  it("tolerates punctuation and hesitation inside a spoken code", () => {
    expect(spokenCodeToDigits("seven, three... nine")).toBe("739");
    expect(spokenCodeToDigits("seven — three — nine")).toBe("739");
    expect(spokenCodeToDigits("seven,three,nine")).toBe("739");
  });

  it("folds the ASR homophones that actually occur on phone lines", () => {
    // oh/zero, for/four, to/too/two, ate/eight, won/one, niner/nine, tree/three
    expect(spokenCodeToDigits("oh zero")).toBe("00");
    expect(spokenCodeToDigits("for four")).toBe("44");
    expect(spokenCodeToDigits("to too two")).toBe("222");
    expect(spokenCodeToDigits("ate eight")).toBe("88");
    expect(spokenCodeToDigits("won one")).toBe("11");
    expect(spokenCodeToDigits("niner nine")).toBe("99");
    expect(spokenCodeToDigits("tree three")).toBe("33");
    // The whole code in homophone form still reduces to the same digits.
    expect(spokenCodeToDigits("seven tree niner to for won")).toBe("739241");
  });

  it("expands double/triple multipliers", () => {
    expect(spokenCodeToDigits("double seven")).toBe("77");
    expect(spokenCodeToDigits("triple three")).toBe("333");
    expect(spokenCodeToDigits("treble four")).toBe("444");
    expect(spokenCodeToDigits("double 7")).toBe("77");
    expect(spokenCodeToDigits("seven double three nine")).toBe("7339");
    expect(spokenCodeToDigits("double-seven")).toBe("77");
  });

  it("drops a multiplier with nothing to multiply instead of throwing", () => {
    expect(spokenCodeToDigits("double")).toBe("");
    expect(spokenCodeToDigits("seven three double")).toBe("73");
    expect(spokenCodeToDigits("double please seven")).toBe("7");
  });

  it("mixes numerals and number words in one utterance", () => {
    expect(spokenCodeToDigits("7 3 nine two 4 1")).toBe("739241");
    expect(spokenCodeToDigits("seven3")).toBe("73");
  });

  it("skips lead-in words that carry no digit", () => {
    expect(spokenCodeToDigits("Sure, it's 7 3 9 2 4 1.")).toBe("739241");
    expect(spokenCodeToDigits("The code is seven three nine two four one, yes.")).toBe("739241");
  });

  it("normalizes fullwidth digits through NFKC", () => {
    expect(spokenCodeToDigits("７３９２４１")).toBe("739241");
  });

  it("returns empty string when nothing digit-like is present", () => {
    for (const spoken of ["", "   ", "...", "sorry, could you repeat that?", "\t\n", "!!!"]) {
      expect(spokenCodeToDigits(spoken)).toBe("");
    }
  });

  it("turns a stray number word into a digit — bounded containment absorbs it", () => {
    // "one moment" contributes a stray leading 1 the normalizer cannot tell
    // apart from the code. POLICY CHANGE, driven by a live call: the callee
    // false-started ("935… 935006") and exact matching wrongly rejected a
    // read-back any human reviewer would accept. The complete code spoken
    // contiguously is the evidence; bounded surrounding noise is not corruption.
    expect(spokenCodeToDigits("one moment — seven three nine")).toBe("1739");
    expect(verifySpokenCode("739", "one moment — seven three nine").match).toBe(true);
    // Filler cannot RESCUE a corrupted code: wrong digit still fails.
    expect(verifySpokenCode("739", "one moment — seven three eight").match).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifySpokenCode — exact after normalization, by design
// ---------------------------------------------------------------------------

describe("verifySpokenCode", () => {
  const expected = "739241";

  it("accepts the code read back verbatim", () => {
    const result = verifySpokenCode(expected, expected);
    expect(result.match).toBe(true);
    expect(result.digits).toBe(expected);
    expect(result.heard).toBe(expected);
  });

  it("accepts every spoken form of the same digits", () => {
    for (const spoken of [
      "7 3 9 2 4 1",
      "739-241",
      "seven three nine two four one",
      "Seven, three... nine, two, four, one.",
      "seven tree niner to for won",
      "It's 739241.",
      "７３９２４１",
    ]) {
      expect(verifySpokenCode(expected, spoken).match).toBe(true);
    }
  });

  it("matches the number-word form against the digit form and vice versa", () => {
    expect(verifySpokenCode("739241", "seven three nine two four one").match).toBe(true);
    expect(verifySpokenCode("seven three nine two four one", "739241").match).toBe(true);
  });

  it("rejects one wrong digit", () => {
    // No tolerance here, unlike the word phrase: forgiving one digit of six
    // would cut the effective space from 10^6 to roughly 1.8e4.
    expect(verifySpokenCode(expected, "739251").match).toBe(false);
    expect(verifySpokenCode(expected, "seven three nine two five one").match).toBe(false);
    expect(verifySpokenCode(expected, "839241").match).toBe(false);
    expect(verifySpokenCode(expected, "739240").match).toBe(false);
  });

  it("rejects a missing digit", () => {
    expect(verifySpokenCode(expected, "73924").match).toBe(false);
    expect(verifySpokenCode(expected, "39241").match).toBe(false);
    expect(verifySpokenCode(expected, "seven three nine two four").match).toBe(false);
  });

  it("tolerates bounded noise around a contiguous complete code (policy: live evidence)", () => {
    // These all contain the full code as one contiguous run within the 2n digit
    // cap — the read-back demonstrably happened; noise around it is not corruption.
    expect(verifySpokenCode(expected, "7392411").match).toBe(true);
    expect(verifySpokenCode(expected, "739241 739241").match).toBe(true);
    expect(verifySpokenCode(expected, "seven three nine two four one zero").match).toBe(true);
  });

  it("still rejects corruption and digit soup", () => {
    // Inserted digit mid-code: no contiguous full run survives.
    expect(verifySpokenCode(expected, "7392941").match).toBe(false);
    // More than 2n digits: too much noise to count as a read-back of anything.
    expect(verifySpokenCode(expected, "0000000 739241").match).toBe(false);
  });

  it("rejects the right digits in the wrong order", () => {
    expect(verifySpokenCode(expected, "739214").match).toBe(false);
    expect(verifySpokenCode(expected, "142937").match).toBe(false);
  });

  it("fails gracefully on empty or garbage input, without throwing", () => {
    for (const spoken of ["", "   ", "...", "sorry, could you repeat that?", "no comment"]) {
      const result = verifySpokenCode(expected, spoken);
      expect(result.match).toBe(false);
      expect(result.digits).toBe("");
    }
  });

  it("reports what was heard, whitespace-collapsed, for diagnostics", () => {
    // The two failure modes must stay distinguishable after the fact: a callee
    // who said the wrong code, vs. a normalizer that mangled a right one.
    const result = verifySpokenCode(expected, "  Uh,  seven   three\nnine  two four   nine. ");
    expect(result.match).toBe(false);
    expect(result.heard).toBe("Uh, seven three nine two four nine.");
    expect(result.digits).toBe("739249");
  });

  it("throws when the expected code itself contains no digit", () => {
    expect(() => verifySpokenCode("", "739241")).toThrow(RangeError);
    expect(() => verifySpokenCode("  ..  ", "739241")).toThrow(RangeError);
  });

  it("verifies a real settlement code end to end", () => {
    const terms: SettlementTerms = {
      amountCents: 84_000,
      conditions: ["Tenant returns the mailbox key by Friday"],
    };
    const code = codeForTerms(terms);
    // What the callee said, as a transcript would carry it: digits spaced out.
    expect(verifySpokenCode(code, code.split("").join(" ")).match).toBe(true);
    // The code for one-cent-different terms must not verify against these terms.
    expect(verifySpokenCode(code, codeForTerms({ ...terms, amountCents: 84_001 })).match).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifySpokenPhrase polymorphism — one entry point, two encodings
// ---------------------------------------------------------------------------

describe("verifySpokenPhrase polymorphism", () => {
  it("routes an all-digit expectation to the code logic", () => {
    const result = verifySpokenPhrase("739241", "seven three nine two four one");
    expect(result.match).toBe(true);
    expect(result.digits).toBe("739241");
    expect(result.heard).toBe("seven three nine two four one");
    expect(result.normalizedDistance).toBe(0);
  });

  it("routes a spaced digit expectation to the code logic too", () => {
    expect(verifySpokenPhrase("7 3 9 2 4 1", "739241").match).toBe(true);
    expect(verifySpokenPhrase("7 3 9 2 4 1", "739242").match).toBe(false);
  });

  it("agrees with verifySpokenCode on the code path, case by case", () => {
    for (const spoken of ["739241", "739251", "73924", "7392411", "", "seven three nine two four one"]) {
      expect(verifySpokenPhrase("739241", spoken).match).toBe(verifySpokenCode("739241", spoken).match);
    }
  });

  it("still reports a usable normalizedDistance on the code path", () => {
    // Ledger writers and the CLI read this field; the code path keeps it
    // meaningful (0 = verbatim, 1 = nothing heard) rather than faking a zero.
    expect(verifySpokenPhrase("739241", "739251").normalizedDistance).toBeCloseTo(1 / 6, 10);
    expect(verifySpokenPhrase("739241", "sorry?").normalizedDistance).toBe(1);
    expect(verifySpokenPhrase("739241", "73924").normalizedDistance).toBeGreaterThan(0);
  });

  it("keeps word-phrase semantics untouched, including the one-slip tolerance", () => {
    const expected = "amber falcon marble";
    expect(verifySpokenPhrase(expected, expected).match).toBe(true);
    expect(verifySpokenPhrase(expected, "amber falcons marble").match).toBe(true); // slip forgiven
    expect(verifySpokenPhrase(expected, "amber eagle marble").match).toBe(false);
    // The code-path fields are absent, so callers can tell which path ran.
    expect(verifySpokenPhrase(expected, expected).digits).toBeUndefined();
    expect(verifySpokenPhrase(expected, expected).heard).toBeUndefined();
  });

  it("never lets what was HEARD choose the path", () => {
    // A callee reading digits at a word-phrase attestation is a failure, not a
    // reason to switch verifiers — and vice versa.
    expect(verifySpokenPhrase("amber falcon marble", "7 3 9 2 4 1").match).toBe(false);
    expect(verifySpokenPhrase("739241", "amber falcon marble").match).toBe(false);
  });

  it("routes a mixed word/digit expectation to the word path", () => {
    // Not a code (it has letters), so it must not be silently reduced to "7".
    const result = verifySpokenPhrase("amber 7", "amber 7");
    expect(result.match).toBe(true);
    expect(result.digits).toBeUndefined();
    expect(verifySpokenPhrase("amber 7", "7").match).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Live-call regression: the transcripts that forced the encoding change
// ---------------------------------------------------------------------------

/**
 * Gate A4, 2026-07-30, four real calls to an owned handset. The attestation
 * phrase was spoken by the agent and read back by the callee; these are the
 * transcripts CALL-E returned, verbatim. Both failed.
 *
 * They are pinned here because the word-phrase code still ships: if someone
 * later "fixes" the verifier by loosening its tolerance until these pass, that
 * is not a fix — it is a verifier that accepts "Joe Pads, chowder, 2nd 1." as
 * proof a human attested to a settlement. The tests assert rejection.
 */
describe("live-call regression (2026-07-30)", () => {
  const HEARD_A = "Joe Pads, chowder, 2nd 1."; // expected: "topaz chowder cyclone"
  const HEARD_B = "Topaz Chowder's Ticulum."; // expected: "topaz chowders cyclone"

  it("the word-phrase path rejects both real transcripts", () => {
    expect(verifySpokenPhrase("topaz chowder cyclone", HEARD_A).match).toBe(false);
    expect(verifySpokenPhrase("topaz chowders cyclone", HEARD_B).match).toBe(false);
  });

  it("both transcripts are far from the phrase — not near-misses a nudge could rescue", () => {
    // MEASURED normalized distances, pinned: 0.545 and 0.304. For scale, the
    // verifier's whole tolerance budget is one edit per word — roughly 0.14 on
    // a phrase this length. These are 2x and 4x past that, so no reachable
    // loosening of the per-word tolerance turns either into a pass; the
    // encoding had to change.
    expect(verifySpokenPhrase("topaz chowder cyclone", HEARD_A).normalizedDistance).toBeCloseTo(0.545, 3);
    expect(verifySpokenPhrase("topaz chowders cyclone", HEARD_B).normalizedDistance).toBeCloseTo(0.304, 3);
  });

  it("neither transcript even preserved the word COUNT", () => {
    // The decoder did not mishear words, it re-segmented the audio: three
    // spoken words came back as five tokens and four tokens respectively.
    expect(HEARD_A.toLowerCase().match(/[a-z0-9]+/g)).toHaveLength(5);
    expect(HEARD_B.toLowerCase().match(/[a-z0-9]+/g)).toHaveLength(4);
  });

  it("names the actual failure: 'cyclone' did not survive either attempt", () => {
    // The words were on the curated list and still came back as unrelated
    // common words. Isolated uncommon words give the decoder no context.
    expect(WORDS).toContain("cyclone");
    expect(WORDS).toContain("topaz");
    expect(WORDS).toContain("chowder");
    expect(HEARD_A.toLowerCase()).not.toContain("cyclone");
    expect(HEARD_B.toLowerCase()).not.toContain("cyclone");
  });

  it("the digit code survives the same channel conditions", () => {
    // Same utterance shapes ASR produced above — hesitation, stray
    // capitalization, trailing punctuation — applied to a spoken code.
    const code = codeForTerms({ amountCents: 96_000, conditions: ["Landlord provides an itemized deduction list"] });
    expect(code).toMatch(/^[0-9]{6}$/);
    const spoken = code.split("").join(", ");
    expect(verifySpokenPhrase(code, `${spoken}.`).match).toBe(true);
    expect(verifySpokenPhrase(code, `Uh, ${spoken}?`).match).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Collision sanity for a 3-word phrase over 256 words (24 bits)
// ---------------------------------------------------------------------------

/** Deterministic PRNG so the collision figure below is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("phrase collision rate", () => {
  it("keeps collisions at the birthday bound over 10k distinct term sets", () => {
    const rnd = mulberry32(0xca0c05);
    const nouns = ["carpet", "remote", "key", "paint", "deposit", "receipt", "blinds", "garage"];
    const canonicalSeen = new Set<string>();
    const phraseOwner = new Map<string, string>();
    let collisions = 0;

    for (let i = 0; i < 10_000; i++) {
      const amountCents = 1 + Math.floor(rnd() * 10_000_000);
      const conditions: string[] = [];
      const count = Math.floor(rnd() * 3);
      for (let c = 0; c < count; c++) {
        conditions.push(`${nouns[Math.floor(rnd() * nouns.length)]} ${Math.floor(rnd() * 100)}`);
      }
      const terms: SettlementTerms = { amountCents, conditions };
      const canonical = canonicalTerms(terms);
      if (canonicalSeen.has(canonical)) continue; // same terms, same phrase by design
      canonicalSeen.add(canonical);

      const phrase = phraseForTerms(terms);
      if (phraseOwner.has(phrase)) collisions++;
      else phraseOwner.set(phrase, canonical);
    }

    // 3 words over 256 = 2^24 phrases; the birthday expectation for ~10k
    // distinct terms is ~3 collisions. Observed at this seed: 2 collisions
    // among 9,998 distinct term sets (0.02%).
    expect(canonicalSeen.size).toBeGreaterThan(9_900);
    expect(collisions).toBeLessThanOrEqual(20);
    expect(collisions / canonicalSeen.size).toBeLessThan(0.005);
    expect(phraseOwner.size).toBe(canonicalSeen.size - collisions);
  });

  it("MEASURED: the 6-digit code collides ~17x more often, over the same 10k term sets", () => {
    // Same generator, same seed, same term sets as the phrase test above, so
    // the two encodings are compared on identical input. This is the number the
    // encoding change costs, measured rather than estimated.
    const rnd = mulberry32(0xca0c05);
    const nouns = ["carpet", "remote", "key", "paint", "deposit", "receipt", "blinds", "garage"];
    const canonicalSeen = new Set<string>();
    const codeOwner = new Map<string, string>();
    let collisions = 0;

    for (let i = 0; i < 10_000; i++) {
      const amountCents = 1 + Math.floor(rnd() * 10_000_000);
      const conditions: string[] = [];
      const count = Math.floor(rnd() * 3);
      for (let c = 0; c < count; c++) {
        conditions.push(`${nouns[Math.floor(rnd() * nouns.length)]} ${Math.floor(rnd() * 100)}`);
      }
      const terms: SettlementTerms = { amountCents, conditions };
      const canonical = canonicalTerms(terms);
      if (canonicalSeen.has(canonical)) continue; // same terms, same code by design
      canonicalSeen.add(canonical);

      const code = codeForTerms(terms);
      if (codeOwner.has(code)) collisions++;
      else codeOwner.set(code, canonical);
    }

    // OBSERVED at this seed: 55 collisions among 9,998 distinct term sets
    // (0.55%). Birthday expectation for n=9,998 over m=10^6 is n^2/2m ≈ 50, so
    // the encoding behaves like a uniform draw. The word phrase over the same
    // input collided 2 times (2^24 keyspace) — the ~17x is the 2^24/10^6 ratio
    // showing up exactly where the arithmetic says it should.
    expect(canonicalSeen.size).toBe(9_998);
    expect(collisions).toBe(55);
    // Distribution bound, not just this seed: 43-58 collisions observed across
    // seeds 0xca0c05, 1, 2 and 3. Asserted with headroom for the tail.
    expect(collisions).toBeLessThanOrEqual(90);
    expect(collisions / canonicalSeen.size).toBeLessThan(0.01);
    expect(codeOwner.size).toBe(canonicalSeen.size - collisions);
  });

  it("a code collision is a nuisance, not a forged attestation", () => {
    // What a collision means: two DIFFERENT settlements happen to speak the
    // same six digits. It does not let anyone attest to terms they were not
    // read, because the code is not the record — the SHA-256 digest is, and it
    // is untouched by this encoding change.
    const a: SettlementTerms = { amountCents: 123_456, conditions: ["Key returned"] };
    const b: SettlementTerms = { amountCents: 654_321, conditions: ["Carpet cleaned"] };
    expect(termsDigest(a)).not.toBe(termsDigest(b));
    // Same terms → same code for both parties: the property attestation needs.
    expect(codeForTerms({ amountCents: 123_456, conditions: [" Key   returned "] })).toBe(codeForTerms(a));
    expect(verifySpokenCode(codeForTerms(a), codeForTerms(a)).match).toBe(true);
  });

  it("a phrase collision is not a verification hazard on its own", () => {
    // Distinct terms sharing a phrase is a 1-in-16.7M audit nuisance, not a
    // security hole: both parties are still read the SAME phrase for the SAME
    // terms, which is the property attestation depends on.
    const terms: SettlementTerms = { amountCents: 123_456, conditions: ["Key returned"] };
    const forPartyA = phraseForTerms(terms);
    const forPartyB = phraseForTerms({ amountCents: 123_456, conditions: [" Key   returned "] });
    expect(forPartyB).toBe(forPartyA);
    expect(verifySpokenPhrase(forPartyA, forPartyB).match).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Golden regression lock
// ---------------------------------------------------------------------------

/**
 * Every other test in this file states its expectation in terms of the
 * implementation (recomputing the digest from `canonicalTerms`, or indexing
 * `WORDS` to predict a phrase). That proves internal consistency but would stay
 * green through a change that silently redefines what a settlement digest MEANS
 * — reordering the wordlist, renaming a canonical key, or changing the sort.
 *
 * These literals are the fixed point. An attestation phrase is spoken on a
 * recorded call and its digest is written into the ledger, so a settlement
 * already attested to must keep resolving to the same phrase forever. If one of
 * these fails, the change is a data-format break for every prior case, not a
 * refactor: bump a version, do not update the constant.
 */
describe("golden values (breaking-change tripwire)", () => {
  const GOLDEN_TERMS: SettlementTerms = {
    amountCents: 125_000,
    conditions: ["Tenant returns the garage remote", "Landlord itemizes the cleaning charge"],
  };
  const GOLDEN_CANONICAL =
    '{"amountCents":125000,"conditions":["Landlord itemizes the cleaning charge","Tenant returns the garage remote"]}';
  const GOLDEN_DIGEST = "5540fa2ba32237f22f50597de8db54a6c396c7a45eab8e85bfa35ad0789e221a";
  const GOLDEN_PHRASE = "giraffe echo willow"; // digest bytes 0x55, 0x40, 0xfa
  const GOLDEN_CODE = "720986"; // digest value mod 10^6

  it("pins the canonical byte string", () => {
    expect(canonicalTerms(GOLDEN_TERMS)).toBe(GOLDEN_CANONICAL);
  });

  it("pins the settlement digest", () => {
    expect(termsDigest(GOLDEN_TERMS)).toBe(GOLDEN_DIGEST);
    expect(sha256Hex(GOLDEN_CANONICAL)).toBe(GOLDEN_DIGEST);
  });

  it("pins the digest → phrase mapping, and therefore the wordlist ORDER", () => {
    expect(phraseForTerms(GOLDEN_TERMS)).toBe(GOLDEN_PHRASE);
    expect(phraseFromDigest(GOLDEN_DIGEST)).toBe(GOLDEN_PHRASE);
    // Literal words, deliberately not written as WORDS[0]/WORDS[1]/WORDS[255]:
    // an alphabetical re-sort of the list would keep an index-based expectation
    // green while changing every phrase ever spoken.
    expect(phraseFromDigest(`0001ff${"0".repeat(58)}`)).toBe("acorn amber zenith");
    expect(WORDS[0]).toBe("acorn");
    expect(WORDS[255]).toBe("zenith");
  });

  it("pins the digest → code mapping", () => {
    // Same standing as the phrase golden above: a settlement already attested
    // to must keep resolving to the same spoken code forever. If this fails,
    // the derivation changed and every prior attestation record changed meaning
    // with it — bump a version, do not update the constant.
    expect(codeForTerms(GOLDEN_TERMS)).toBe(GOLDEN_CODE);
    expect(codeFromDigest(GOLDEN_DIGEST)).toBe(GOLDEN_CODE);
    // The suffix relation, pinned on literals rather than recomputed.
    expect(codeFromDigest(GOLDEN_DIGEST, 4)).toBe("0986");
    expect(codeFromDigest(GOLDEN_DIGEST, 8)).toBe("55720986");
  });

  it("verifies the golden code as a phone line would deliver it", () => {
    expect(verifySpokenPhrase(GOLDEN_CODE, "7 2 0 9 8 6").match).toBe(true);
    expect(verifySpokenPhrase(GOLDEN_CODE, "seven two oh nine eight six").match).toBe(true);
    expect(verifySpokenPhrase(GOLDEN_CODE, "seven two zero nine ate six").match).toBe(true);
    expect(verifySpokenPhrase(GOLDEN_CODE, "7 2 0 9 8 7").match).toBe(false);
  });

  it("rejects run-together words, so a merged transcript cannot pass", () => {
    // Two words heard as one is a length mismatch, not a per-word slip.
    expect(verifySpokenPhrase(GOLDEN_PHRASE, "giraffeecho willow").match).toBe(false);
    expect(verifySpokenPhrase(GOLDEN_PHRASE, "giraffe echowillow").match).toBe(false);
    expect(verifySpokenPhrase(GOLDEN_PHRASE, "giraffeechowillow").match).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Live-call fixtures — Gate A4 round 3, 2026-07-30/08-08. These are the ACTUAL
// strings a real CALL-E agent captured from a real callee over a real phone
// line. They are the reason verifySpokenCode tolerates a bounded false start.
// ---------------------------------------------------------------------------
describe("live-call regression fixtures (Gate A4)", () => {
  const CODE = "935006";

  it('accepts the live false start: "935 935006" (complete code after a restart)', () => {
    const v = verifySpokenCode(CODE, "935 935006.");
    expect(v.match).toBe(true);
    expect(v.digits).toBe("935935006");
  });

  it('rejects the live dropped-digit read-back: "93006"', () => {
    expect(verifySpokenCode(CODE, "93006.").match).toBe(false);
  });

  it('rejects the live inserted-digit read-back: "9 3 5 0 0 9 6"', () => {
    expect(verifySpokenCode(CODE, "9 3 5 0 0 9 6.").match).toBe(false);
  });

  it("rejects digit soup even when it contains the code (containment is bounded)", () => {
    // 13 digits > 2×6: too much surrounding noise to count as a read-back.
    expect(verifySpokenCode(CODE, "1234567 935006").match).toBe(false);
    // At exactly the bound (12 digits) containment still counts.
    expect(verifySpokenCode(CODE, "935005 935006").match).toBe(true);
  });

  it("still requires contiguity: a false start cannot repair a wrong digit", () => {
    // "935 935096" — restart also wrong; no contiguous 935006 anywhere.
    expect(verifySpokenCode(CODE, "935 935096").match).toBe(false);
  });

  it("the polymorphic verifier reaches the same verdicts (state-machine path)", () => {
    expect(verifySpokenPhrase(CODE, "935 935006.").match).toBe(true);
    expect(verifySpokenPhrase(CODE, "93006.").match).toBe(false);
  });
});
