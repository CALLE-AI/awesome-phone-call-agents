import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The reusable adapter in `src/calle/` must not depend on any workflow. Without
 * this check the dependency quietly inverts the first time something in the
 * adapter needs a domain constant, and the claim that a second workflow is cheap
 * stops being true while still being documented.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((match) => match[1]);
}

test("the CALL-E adapter imports no workflow code", () => {
  for (const file of sourceFiles(path.join(ROOT, "src/calle"))) {
    for (const specifier of importsOf(file)) {
      assert.ok(
        !specifier.includes("workflows"),
        `${path.relative(ROOT, file)} imports ${specifier}; the adapter must stay workflow-agnostic`,
      );
    }
  }
});

test("the CALL-E adapter names no workflow domain concepts in its code", () => {
  const domainWords = /\b(appointment|reschedul|salon|replacement_window|recovery)/i;
  for (const file of sourceFiles(path.join(ROOT, "src/calle"))) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const match = code.match(domainWords);
    assert.equal(
      match,
      null,
      `${path.relative(ROOT, file)} mentions "${match?.[0]}"; that belongs in a workflow`,
    );
  }
});

test("workflow code reaches CALL-E only through the adapter", () => {
  for (const file of sourceFiles(path.join(ROOT, "src/workflows"))) {
    for (const specifier of importsOf(file)) {
      assert.ok(
        !/calle\/(client|status|mask)/.test(specifier),
        `${path.relative(ROOT, file)} imports ${specifier}; import from "../../calle" instead`,
      );
    }
  }
});
