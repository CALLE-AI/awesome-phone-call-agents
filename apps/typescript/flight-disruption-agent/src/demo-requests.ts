// Terminal walkthrough of Workflow B with the dry-run gateway. Places no calls.
import { DryRunGateway } from "./calle.ts";
import { loadCatalog } from "./data.ts";
import { Desk } from "./desk.ts";
import { idr } from "./format.ts";

// Fixed "today" the day before the fixture flights, so the change cutoff never blocks the demo.
const now = () => new Date("2026-09-19T08:00:00+07:00").getTime();
const desk = new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now });

const scripted = [
  { pnr: "L6F2KM", kind: "reschedule", target: "NA729-2026-09-20", note: "portal accepts" },
  { pnr: "P3X9GA", kind: "reschedule", target: "NA729-2026-09-20", note: "portal refuses, airline desk reissues" },
  { pnr: "C5V8EJ", kind: "reschedule", target: "NA729-2026-09-20", note: "portal refuses, airline desk refuses" },
  { pnr: "T5W1LC", kind: "refund", target: null, note: "non-refundable basic fare" },
  { pnr: "H8J3PV", kind: "reschedule", target: "NA729-2026-09-20", note: "different route, not eligible" },
] as const;

console.log("\nPassenger requests (Workflow B, dry run)\n");
for (const s of scripted) {
  const entry = desk.submitRequest(s.pnr, s.kind, s.target, "chat");
  const id = entry.request.id;
  console.log(`${s.pnr}  ${s.kind}${s.target ? ` -> ${s.target}` : ""}  (${s.note})`);
  if (entry.status === "ineligible") {
    console.log(`        not eligible: ${entry.eligibility.reasons.join(" ")}\n`);
    continue;
  }
  console.log(`        quote ${idr(entry.amount ?? 0)}${entry.eligibility.warnings.length ? `  [${entry.eligibility.warnings.join(" ")}]` : ""}`);
  const after = desk.confirmRequest(id, entry.amount ?? 0);
  console.log(`        passenger confirmed -> portal ${after.portal?.kind}${after.portal?.kind === "rejected" ? ` (${after.portal.code})` : ""}`);
  if (after.status === "portal_rejected") {
    await desk.callAirlineDesk(id);
    const desked = await desk.refreshRequest(id);
    console.log(`        airline desk: ${desked.airlineCall?.outcome?.summary ?? desked.status}`);
  }
  const final = desk.snapshot().requests.find((r) => r.request.id === id);
  console.log(`        ${final?.status}: ${final?.applied ?? final?.reviewReasons.join(" ")}\n`);
}
