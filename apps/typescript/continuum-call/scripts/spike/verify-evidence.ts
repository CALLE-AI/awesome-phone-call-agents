#!/usr/bin/env node
/**
 * Independent evidence verify CLI — reads a downloaded pack JSON.
 * Usage: npm run verify:evidence -- path/to/pack.json
 */
import { readFileSync } from "node:fs";
import {
  verifyEvidencePack,
  type EvidencePack,
} from "../../src/runtime/evidence.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run verify:evidence -- <pack.json>");
  process.exit(2);
}

const raw = JSON.parse(readFileSync(path, "utf8")) as EvidencePack;
const v = verifyEvidencePack(raw);

console.log(
  JSON.stringify(
    {
      ok: v.ok,
      badge: v.badge,
      ledger_matches_recompute: v.ledger_matches_recompute,
      mission_status_matches: v.mission_status_matches,
      errors: v.errors,
    },
    null,
    2,
  ),
);

process.exit(v.ok ? 0 : 1);
