// File: scripts/verify-claims.ts
// Run: pnpm tsx scripts/verify-claims.ts  (exit 1 on any mismatch)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { normalizeCallTask, type FairPrices } from "../src/lib/normalize";
import type { CallTask } from "../src/lib/calle-types";

const fixture = JSON.parse(readFileSync("data/fixtures/mri-72148.json", "utf8")) as CallTask;
const fair = JSON.parse(readFileSync("data/fair-prices.json", "utf8")) as FairPrices;

const n = normalizeCallTask(fixture, fair, "72148");
const winner = n.results.find((r) => r.ranked);

const claims = {
  winner_landed: 438,
  lowest_all_inclusive: 438,
  ranked_count: 1,
  non_comparable_count: 1,
  no_quote_count: 2,
};

const actual = {
  winner_landed: winner?.landed_cost ?? null,
  lowest_all_inclusive: n.rollup.lowest_all_inclusive,
  ranked_count: n.results.filter((r) => r.ranked).length,
  non_comparable_count: n.results.filter((r) => r.status === "non_comparable").length,
  no_quote_count: n.results.filter((r) => r.status === "no_quote").length,
};

let ok = true;
for (const k of Object.keys(claims) as (keyof typeof claims)[]) {
  if (claims[k] !== actual[k]) {
    console.error(`MISMATCH ${k}: claimed ${claims[k]} actual ${actual[k]}`);
    ok = false;
  }
}

mkdirSync("evidence", { recursive: true });
writeFileSync("evidence/verify-claims.json", JSON.stringify({ claims, actual, ok }, null, 2));

if (!ok) {
  console.error("verify-claims FAILED");
  process.exit(1);
}
console.log("verify-claims OK — all headline numbers recomputed from committed fixtures.");
