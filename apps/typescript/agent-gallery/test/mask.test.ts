import assert from "node:assert/strict";
import test from "node:test";
import { maskE164 } from "../src/lib/mask";

test("masks the middle of an E.164 number", () => {
  assert.equal(maskE164("+6580000000"), "+65•••••000");
});

test("keeps only the plus, two leading digits, and three trailing digits", () => {
  const masked = maskE164("+14155550123");
  assert.equal(masked, "+14••••••123");
  assert.ok(!masked.includes("55550"));
});

test("returns a fully masked placeholder for malformed input", () => {
  assert.equal(maskE164("041-555"), "•••");
  assert.equal(maskE164(""), "•••");
});
