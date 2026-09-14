// Terminal walkthrough of Workflow B with the dry-run gateway. Places no calls.
// Passenger -> CALL-E (agrees the change) -> CALL-E -> airline desk (makes it).
import { DryRunGateway } from "./calle.ts";
import { loadCatalog } from "./data.ts";
import { Desk } from "./desk.ts";
import { idr } from "./format.ts";
import type { RequestKind } from "./types.ts";

// Fixed "today" the day before the fixture flights, so the change cutoff never blocks the demo.
const now = () => new Date("2026-09-19T08:00:00+07:00").getTime();
const desk = new Desk(loadCatalog(), new DryRunGateway(0), { statePath: null, liveCallBudget: 0, now });

const scripted: { pnr: string; kind: RequestKind; target: string | null; note: string }[] = [
  { pnr: "L6F2KM", kind: "reschedule", target: "NA729-2026-09-20", note: "agrees on the call, airline desk reissues" },
  { pnr: "C5V8EJ", kind: "reschedule", target: "NA729-2026-09-20", note: "agrees on the call, airline desk refuses" },
  { pnr: "W4N7QS", kind: "refund", target: null, note: "accepts the refund, airline desk approves" },
  { pnr: "K7Q2XA", kind: "change", target: null, note: "decides to keep the booking" },
  { pnr: "B9H4ZN", kind: "change", target: null, note: "asks for a person" },
  { pnr: "H8J3PV", kind: "reschedule", target: "NA729-2026-09-20", note: "different route, not eligible" },
];

console.log("\nPassenger requests (Workflow B, dry run)\n");
for (const s of scripted) {
  const entry = desk.submitRequest(s.pnr, s.kind, s.target, "chat");
  const id = entry.request.id;
  console.log(`${s.pnr}  ${s.kind}${s.target ? ` -> ${s.target}` : ""}  (${s.note})`);
  if (entry.status === "ineligible") {
    console.log(`        not eligible: ${entry.eligibility.reasons.join(" ")}\n`);
    continue;
  }
  await desk.callPassengerForRequest(id);
  const agreed = await desk.refreshPassengerCall(id);
  console.log(`        CALL-E -> passenger: ${agreed.passengerCall?.outcome?.summary ?? agreed.status}`);
  if (agreed.status === "confirmed_on_call") {
    console.log(`        agreed ${agreed.action?.kind} for ${idr(agreed.amount ?? 0)}`);
    await desk.callAirlineDesk(id);
    const desked = await desk.refreshRequest(id);
    console.log(`        CALL-E -> airline desk: ${desked.airlineCall?.outcome?.summary ?? desked.status}`);
  }
  const final = desk.snapshot().requests.find((r) => r.request.id === id);
  console.log(`        ${final?.status}: ${final?.applied ?? (final?.reviewReasons.join(" ") || "nothing changed")}\n`);
}
