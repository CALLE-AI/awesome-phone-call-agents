import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(['node_modules', '.git', 'build', '.zapierapprc']);
const TEXT = /\.(js|mjs|json|md|yml|yaml)$/;

function sourceFiles(dir = ROOT, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (TEXT.test(entry)) found.push(path);
  }
  return found;
}

// A stray NUL byte makes git classify a source file as binary, so GitHub
// stops rendering its diff and a reviewer sees "Binary file not shown" for
// code they were asked to review. Nothing else in this suite can catch it:
// `lib/grounding.js` carried one inside a string separator for several
// commits while every functional test passed, because the byte normalized
// away before any assertion ever saw it.
describe('source hygiene', () => {
  const files = sourceFiles();

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('keeps every tracked source file free of NUL bytes', () => {
    const offenders = files
      .filter((path) => readFileSync(path).includes(0))
      .map((path) => path.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
});
