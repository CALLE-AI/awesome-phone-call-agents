/**
 * Minimal .env loader. Deliberately dependency-free and deliberately dumb:
 * it never overrides a variable that is already present in the real process
 * environment, so container/platform secrets always win over a stray local file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Walk up from `startDir` looking for a .env, and merge it in without clobbering. */
export function loadEnv(startDir: string = process.cwd()): void {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      const parsed = parse(readFileSync(candidate, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
