import assert from "node:assert/strict";
import test from "node:test";
import { chunksOf, normalizeSourceText } from "../lib/source-indexing.ts";

test("source text normalization removes binary nulls and excessive blank lines", () => {
  assert.equal(normalizeSourceText("Decision\0\r\n\n\n  Owner: Ada  \n"), "Decision\n\n  Owner: Ada");
});

test("source chunks overlap without dropping text", () => {
  const source = "x".repeat(3000);
  const chunks = chunksOf(source);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 1600);
  assert.equal(chunks[1].length, 1600);
  assert.equal(chunks[2].length, 200);
  assert.equal(chunks[0].slice(1400), chunks[1].slice(0, 200));
});
