import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ---------------------------------------------------------------------------
// Mock DOM globals before importing the module
// ---------------------------------------------------------------------------

/**
 * Minimal stub for document.querySelector that returns stub elements.
 * @param {string} id - Element identifier.
 * @returns {Object} Mock DOM element.
 */
const stubElement = (id) => ({
  id,
  hidden: false,
  disabled: false,
  checked: false,
  value: "",
  textContent: "",
  innerHTML: "",
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  focus() {},
  play() { return Promise.resolve(); },
  pause() {},
  scrollIntoView() {},
  querySelector() { return stubElement("child"); },
  addEventListener() {},
  onclick: null,
  onchange: null,
});

globalThis.document = {
  querySelector: (sel) => stubElement(sel),
  querySelectorAll: () => [],
  createElement: () => stubElement("created"),
  body: { classList: { add() {}, remove() {} } },
};

globalThis.window = { scrollTo() {} };

// Now import the module under test
const { esc } = await import("../public/js/dom.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("esc() returns empty string for null and undefined", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("esc() returns the string itself when there are no special characters", () => {
  assert.equal(esc("hello world"), "hello world");
  assert.equal(esc("Amoxicillin 500mg"), "Amoxicillin 500mg");
});

test("esc() escapes ampersands", () => {
  assert.equal(esc("a & b"), "a &amp; b");
  assert.equal(esc("&&"), "&amp;&amp;");
});

test("esc() escapes angle brackets", () => {
  assert.equal(esc("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(esc("a < b > c"), "a &lt; b &gt; c");
});

test("esc() escapes double quotes", () => {
  assert.equal(esc('He said "hello"'), "He said &quot;hello&quot;");
});

test("esc() escapes multiple special characters in one string", () => {
  assert.equal(
    esc('<img src="x" onerror="alert(1)">'),
    "&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;"
  );
});

test("esc() coerces non-string values to string", () => {
  assert.equal(esc(42), "42");
  assert.equal(esc(0), "0");
  assert.equal(esc(true), "true");
  assert.equal(esc(false), "false");
});

test("esc() handles empty string", () => {
  assert.equal(esc(""), "");
});

test("esc() does not escape single quotes (not in the map)", () => {
  assert.equal(esc("it's"), "it's");
});

test("strength value accepts a typed whole number instead of a preset list", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<input id="strength-value" type="number"[^>]*min="1"[^>]*step="1"/);
  assert.doesNotMatch(html, /<select id="strength-value"/);
});

test("workspace omits optional purchase, release, and brand inputs", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="requested-quantity"/);
  assert.doesNotMatch(html, /id="release-type"/);
  assert.doesNotMatch(html, /id="preferred-brand"/);
});
