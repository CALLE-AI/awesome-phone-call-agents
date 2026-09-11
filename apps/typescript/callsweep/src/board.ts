import type { Quote } from "./types";
import type { Booking } from "./book";
import { maskPhone } from "./phone";

// Reveal results one at a time so the sweep looks live in a screen recording.
const STEP = Number(process.env.STEP_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const row = (name: string, rest: string, width = 26) => {
  const n = name.length > width ? name.slice(0, width - 1) + "…" : name;
  return `     ${(n + " ").padEnd(width, ".")}  ${rest}`;
};

export function header(label: string) {
  console.log(`\n  CALLSWEEP  -  ${label}\n`);
}

// Printed BEFORE the calls are placed, so the screen is not blank while the
// (blocking) real calls run. In live mode it tells the user to pick up.
export function calling(n: number, live = false) {
  const s = n === 1 ? "" : "s";
  console.log(`  Calling ${n} shop${s}...\n`);
}

export async function showQuotes(quotes: Quote[]) {
  for (const q of quotes) {
    await sleep(STEP);
    let rest: string;
    if (!q.answered) rest = "no answer";
    else if (q.available !== "yes") rest = q.availableDetail || "unavailable";
    else if (q.price === null) rest = "wouldn't quote";
    else {
      const extras = q.includes.length ? `  +${q.includes.join(", ")}` : "";
      // Show the haggle when the price dropped from the opening quote.
      const money =
        q.openingPrice && q.openingPrice > q.price
          ? `$${q.openingPrice} -> $${q.price}`
          : `$${q.price}`;
      rest = `${money}  ${q.availableDetail}${extras}`;
    }
    console.log(row(q.vendor, rest));
  }
}

export function showRanking(ranked: Quote[], bar: string) {
  console.log(`\n  Best by ${bar}:`);
  ranked.forEach((q, i) => {
    const extras = q.includes.length ? `  +${q.includes.join(", ")}` : "";
    console.log(`     [${i + 1}] ${q.vendor.padEnd(22)} $${q.price}${extras}`);
  });
}

export function showBooking(b: Booking) {
  console.log(`\n  ${b.confirmed ? "* BOOKED" : "! NOT confirmed (halted)"} - ${b.vendor}\n`);
  if (b.note) console.log(`     note      ${b.note}`);
  console.log(`     service   ${b.service}`);
  console.log(`     price     $${b.price}`);
  if (b.includes.length) console.log(`     includes  ${b.includes.join(", ")}`);
  console.log(`     when      ${b.when}`);
  if (b.address) console.log(`     where     ${b.address}`);
  console.log(`     phone     ${maskPhone(b.phoneE164)}`);
  console.log(`     ref       ${b.reference}\n`);
}
