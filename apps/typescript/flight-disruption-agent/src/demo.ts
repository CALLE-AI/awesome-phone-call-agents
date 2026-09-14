// Terminal walkthrough of the whole flow with the dry-run gateway. Places no calls.
import { DryRunGateway } from "./calle.ts";
import { loadCatalog } from "./data.ts";
import { Desk } from "./desk.ts";
import { idr } from "./format.ts";

const desk = new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0 });
// npm run demo [minutes | cancel] [fm]   e.g. `npm run demo 90`, `npm run demo cancel fm`
const arg = process.argv[2] ?? "240";
const cause = process.argv[3] === "fm" ? "force_majeure" : "operational";
const disruption =
  arg === "cancel"
    ? desk.reportCancellation("NA721-2026-09-20", cause === "force_majeure" ? "volcanic ash on the route" : "a crew shortage", cause)
    : desk.reportDelay("NA721-2026-09-20", Number(arg), cause === "force_majeure" ? "volcanic ash on the route" : "a late inbound aircraft", cause);
const first = desk.snapshot().disruptions[0];
if (!first) throw new Error("No disruption recorded");

const what = disruption.kind === "cancellation" ? "cancelled" : `delayed ${disruption.delayMinutes} min`;
console.log(`\nNA 721 CGK-SIN ${what} (${disruption.reason}) -> ${first.bookings[0]?.quote.changeCase} change\n`);
for (const b of first.bookings) {
  const chain = b.channel.map((c) => c.name).join(" -> ");
  const cheapestMove = b.quote.moves.reduce((min, m) => Math.min(min, m.total), Infinity);
  console.log(`${b.pnr}  ${b.passenger.padEnd(16)} ${b.fareFamily.padEnd(6)} ${chain}`);
  const keep = b.quote.keep ? "keep free | " : "";
  console.log(`        ${keep}move from ${idr(cheapestMove)} | refund ${idr(b.quote.refund.amount)} of ${idr(b.farePaid)}`);
}

console.log("\nCalling each passenger (dry run)...\n");
for (const b of first.bookings) {
  await desk.startCall(disruption.id, b.pnr);
  const entry = await desk.refresh(`${disruption.id}:${b.pnr}`);
  const verdict = entry.status === "applied" ? entry.applied : `REVIEW: ${entry.decision?.kind === "review" ? entry.decision.reasons.join(" ") : ""}`;
  console.log(`${b.pnr}  ${entry.outcome?.result?.choice ?? entry.outcome?.state}  ->  ${verdict}`);
}
console.log();
