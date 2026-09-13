import assert from "node:assert/strict";
import test from "node:test";
import {
  CODE_DIGITS,
  PHRASE_LENGTH,
  containsCode,
  containsPhrase,
  deriveSecret,
  generateCode,
  generatePhrase,
  phraseEntropyBits,
  redactSecret,
  secretDigest,
  spokenCode,
  spokenDigits,
} from "../src/secret.js";

const KEY = Buffer.from("operator key material for the tests, 44 bytes", "utf8");
const CONTEXT = { requestDigest: "sha256:aaaa", approverId: "alice", attempt: 1 };

test("generated codes are six digits from the platform CSPRNG", () => {
  for (let index = 0; index < 200; index += 1) {
    const code = generateCode();
    assert.equal(code.length, CODE_DIGITS);
    assert.match(code, /^\d{6}$/);
  }
});

test("generated codes are not all the same value", () => {
  const codes = new Set(Array.from({ length: 50 }, () => generateCode()));
  assert.ok(codes.size > 40, `expected varied codes, saw ${codes.size} distinct`);
});

test("phrases have three distinct words and enough bits to report", () => {
  const phrase = generatePhrase();
  assert.equal(phrase.length, PHRASE_LENGTH);
  assert.equal(new Set(phrase).size, PHRASE_LENGTH);
  assert.ok(phraseEntropyBits() >= 20, `expected at least 20 bits, got ${phraseEntropyBits()}`);
});

test("codes are read out one digit at a time", () => {
  assert.equal(spokenCode("472913"), "4 7 2 9 1 3");
});

test("spoken digits survive words, homophones and punctuation", () => {
  assert.equal(spokenDigits("four seven two nine one three"), "472913");
  assert.equal(spokenDigits("Sure, it is 47-29-13."), "472913");
  assert.equal(spokenDigits("four seven two, niner, one, three"), "472913");
  assert.equal(spokenDigits("for seven two nine one three"), "472913");
  assert.equal(spokenDigits("oh four seven two nine one three"), "0472913");
});

test("a code is matched inside a sentence but not when a digit is wrong", () => {
  assert.equal(containsCode("the code is 472913, go ahead", "472913"), true);
  assert.equal(containsCode("four seven two nine one three", "472913"), true);
  assert.equal(containsCode("472914", "472913"), false);
  assert.equal(containsCode("I do not have a code", "472913"), false);
});

test("a phrase matches only when the words come back in order", () => {
  const phrase = ["anchor", "cobalt", "meadow"];
  assert.equal(containsPhrase("anchor cobalt meadow", phrase), true);
  assert.equal(containsPhrase("the words were anchor, cobalt and meadow, right?", phrase), true);
  assert.equal(containsPhrase("meadow cobalt anchor", phrase), false);
  assert.equal(containsPhrase("anchor and meadow", phrase), false);
});

test("digests bind a record to a secret and differ across requests", () => {
  const first = secretDigest("deploy-1", "472913");
  const second = secretDigest("deploy-2", "472913");
  assert.equal(first, secretDigest("deploy-1", "472913"));
  assert.notEqual(first, second);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
});

test("redaction removes spoken codes and phrase words before they are stored", () => {
  assert.equal(redactSecret("the code is 472913", "472913", []), "the code is [code]");
  assert.equal(redactSecret("four seven two nine one three", "472913", []), "[code]");
  assert.equal(
    redactSecret("anchor cobalt meadow, approved", "472913", ["anchor", "cobalt", "meadow"]),
    "[phrase] [phrase] [phrase], approved",
  );
  assert.equal(redactSecret("I approve", "472913", []), "I approve");
});

test("a code that is not ours is redacted too, so a record never carries one", () => {
  assert.equal(redactSecret("819274, approved", "472913", []), "[digits], approved");
  assert.equal(
    redactSecret("eight one nine two seven four, approved", "472913", []),
    "[digits], approved",
  );
  // Too short to be a code read-back, so it stays readable.
  assert.equal(redactSecret("I am on extension 4155", "472913", []), "I am on extension 4155");
});

test("a derived secret is the same on every runner and different for anything else", () => {
  const derived = deriveSecret(KEY, CONTEXT);
  assert.match(derived.code, /^\d{6}$/);
  assert.equal(derived.phrase.length, PHRASE_LENGTH);
  assert.equal(new Set(derived.phrase).size, PHRASE_LENGTH);

  // No coordination, no shared filesystem, same code. That is the point.
  const other = deriveSecret(Buffer.from(KEY), { ...CONTEXT });
  assert.equal(other.code, derived.code);
  assert.deepEqual(other.phrase, derived.phrase);

  assert.notEqual(deriveSecret(KEY, { ...CONTEXT, attempt: 2 }).code, derived.code);
  assert.notEqual(deriveSecret(KEY, { ...CONTEXT, approverId: "bob" }).code, derived.code);
  assert.notEqual(deriveSecret(KEY, { ...CONTEXT, requestDigest: "sha256:bbbb" }).code, derived.code);
  assert.notEqual(deriveSecret(Buffer.from(`${KEY.toString()} rotated`), CONTEXT).code, derived.code);
  assert.notDeepEqual(deriveSecret(KEY, { ...CONTEXT, attempt: 2 }).phrase, derived.phrase);
});

test("derived codes spread across the code space", () => {
  const codes = new Set(
    Array.from({ length: 200 }, (_ignored, index) =>
      deriveSecret(KEY, { ...CONTEXT, requestDigest: `sha256:${index}` }).code,
    ),
  );
  assert.ok(codes.size > 190, `expected varied codes, saw ${codes.size} distinct`);
});

test("key material too short to derive from is refused", () => {
  assert.throws(() => deriveSecret(Buffer.from("too short"), CONTEXT), /128 bits/);
});
