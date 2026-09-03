import { gatherQuotes } from "./calle";
import { rankQuotes } from "./rank";
import { ambiguousQuotes } from "./reconcile";
import { book } from "./book";
import { parseRequest } from "./intake";
import { discoverByRequest } from "./discovery";
import { isE164, maskPhone } from "./phone";
import { isAuthorized } from "./authz";
import * as board from "./board";
import type { Vendor } from "./types";
import vendorsCache from "../fixtures/vendors.json";

// Mock by default. Real calls only happen with MOCK=false.
const MOCK = process.env.MOCK !== "false";

// Callsweep entry point. Runs in MOCK mode by default (no calls).
// Set MOCK=false to place real calls to the vendors below.
//
// Usage:  bun run src/index.ts "cheapest haircut near me today"

const request = process.argv.slice(2).join(" ") || "cheapest haircut in San Francisco";
const { goal, bar, category, location, budget: parsedBudget } = await parseRequest(request);

board.header(request);

// The value the customer wants to hit. If they did not put one in the request,
// ask once. This target is taken into every call so shops price against it in
// a single round (no separate negotiation round).
let budget = parsedBudget;
if (budget === null) {
  const b = prompt(`  Target budget in $ (press Enter to skip):`);
  const n = b ? Number(b.replace(/[^0-9.]/g, "")) : NaN;
  if (Number.isFinite(n) && n > 0) budget = n;
}
if (budget) console.log(`  Target budget: $${budget}\n`);

// SAFE TESTING: set TEST_PHONES="+9199...,+9198..." to run against your OWN
// numbers instead of real businesses. Skips discovery entirely.
const testPhones = process.env.TEST_PHONES?.split(",").map((s) => s.trim()).filter(Boolean);

// Reject any TEST_PHONES value that is not strict E.164 before it can be dialed.
if (testPhones) {
  const invalid = testPhones.filter((p) => !isE164(p));
  if (invalid.length > 0) {
    console.error(`TEST_PHONES has invalid E.164 numbers (must look like +14155550100). Aborting.`);
    process.exit(1);
  }
}

let vendors: Vendor[] = [];
if (testPhones && testPhones.length > 0) {
  vendors = testPhones.map((p, i) => ({
    name: `Test Shop ${i + 1}`,
    phoneE164: p,
    region: p.startsWith("+91") ? "IN" : "US",
  }));
  console.log(`  Using ${vendors.length} TEST numbers (your own).\n`);
} else if (location) {
  // Discover real businesses for this category + location (OSM, no key).
  try {
    vendors = await discoverByRequest(category, location, 6);
  } catch {
    /* fall through to cache */
  }
}

if (vendors.length === 0) {
  vendors = vendorsCache as Vendor[];
  console.log(`  Using ${vendors.length} sample shops.\n`);
} else if (!testPhones) {
  console.log(`  Found ${vendors.length} ${category} in ${location}.\n`);
}

// Consent gate: in real mode, only dial recipients that are BOTH on the
// operator's allowlist (ALLOWED_PHONES) and confirmed at the prompt.
if (!MOCK && vendors.length > 0) {
  const authorized = vendors.filter((v) => isAuthorized(v.phoneE164));
  if (authorized.length === 0) {
    console.log(
      `  No authorized recipients. Set ALLOWED_PHONES to explicitly authorize each\n` +
        `  number before dialing. No calls placed.\n`
    );
    process.exit(0);
  }
  console.log(`  About to place REAL calls to ${authorized.length} authorized numbers:`);
  for (const v of authorized) console.log(`    - ${v.name}  ${maskPhone(v.phoneE164)}`);
  const answer = prompt(`  Type "yes" to confirm:`);
  if (answer?.trim().toLowerCase() !== "yes") {
    console.log(`  Not confirmed. No calls placed.\n`);
    process.exit(0);
  }
  vendors = authorized; // dial only the authorized subset
  console.log("");
}

// One round of calls. With a budget set, each shop already priced against it.
board.calling(vendors.length, !MOCK);
const quotes = await gatherQuotes(vendors, goal, category, budget);
await board.showQuotes(quotes);

// Halt on any ambiguous outcome. If a call did not answer, did not complete, or
// gave no clear price, the comparison is incomplete, so we do NOT advance to a
// booking. The run stops for a human to reconcile the unclear shops first.
const unclear = ambiguousQuotes(quotes);
if (unclear.length > 0) {
  console.log(
    `\n  Halted: ${unclear.length} shop(s) gave no clear result ` +
      `(${unclear.map((q) => q.vendor).join(", ")}). The comparison is ` +
      `incomplete, so no booking. Reconcile these manually before booking.\n`
  );
  process.exit(0);
}

const ranked = rankQuotes(quotes, bar);

if (ranked.length === 0) {
  console.log(`\n  No shop can meet the request.\n`);
} else {
  board.showRanking(ranked, bar);

  // You decide. Pick which deal to book (or skip).
  const pick = choosePick(ranked.length);
  if (pick === null) {
    console.log(`\n  No booking made.\n`);
  } else {
    const winnerQuote = ranked[pick]!;
    const service = location ? `${category} in ${location}` : category;
    const booking = await book(winnerQuote, winnerQuote.price!, service);
    board.showBooking(booking);
  }
}

// Ask which ranked shop to book. Returns a 0-based index, or null to skip.
// Fails CLOSED: no input, a cancelled prompt, or an invalid choice books
// nothing. A booking is a real side effect, so it needs an explicit selection,
// never a default. (Mirrors the consent gate above.)
function choosePick(count: number): number | null {
  const answer = prompt(`\n  Book which? Enter 1-${count} (or 0 to skip):`);
  if (answer === null) {
    console.log(`  No selection made. No booking.`);
    return null;
  }
  const n = Number(answer.trim());
  if (!Number.isInteger(n) || n < 0 || n > count) {
    console.log(`  Not a valid choice. No booking made.`);
    return null;
  }
  return n === 0 ? null : n - 1;
}
