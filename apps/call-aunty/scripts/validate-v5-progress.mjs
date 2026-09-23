#!/usr/bin/env node
/** Validates docs/calle-v5/progress.md lists PAGE 001–010 (foundation slice). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const progress = readFileSync(join(process.cwd(), "docs", "calle-v5", "progress.md"), "utf8");
const required = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return `PAGE ${n}`;
});

const missing = required.filter((id) => !progress.includes(id));
if (missing.length) {
  console.error("Missing progress entries:", missing.join(", "));
  process.exit(1);
}
console.log("V5 progress ledger: foundation pages 001–010 present.");
process.exit(0);
