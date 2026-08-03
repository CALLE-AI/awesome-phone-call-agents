/**
 * Resolve the static public directory for both dev (src/) and compiled (dist/) layouts.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isPublicDirectory(dir: string): boolean {
  if (!existsSync(dir)) {
    return false;
  }
  try {
    return statSync(dir).isDirectory() && existsSync(join(dir, "index.html"));
  } catch {
    return false;
  }
}

/**
 * Locate public/ relative to the server module.
 *
 * Compiled runtime: dist/server.js + dist/public/
 * Dev runtime: src/server.ts + project public/
 */
export function resolvePublicDirectory(moduleUrl: string): string {
  const serverDir = resolve(dirname(fileURLToPath(moduleUrl)));
  const candidates = [
    join(serverDir, "public"),
    join(serverDir, "..", "public"),
  ].map((candidate) => resolve(candidate));

  const tried: string[] = [];
  for (const candidate of candidates) {
    if (tried.includes(candidate)) {
      continue;
    }
    tried.push(candidate);
    if (isPublicDirectory(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `DrillSignal static assets not found. Expected public/index.html beside or above the server module. Tried: ${tried.join(", ")}`,
  );
}
