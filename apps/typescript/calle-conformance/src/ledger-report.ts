/**
 * Prints what each accounting hypothesis predicts, beside what the counter
 * actually reads, and marks which hypotheses that reading eliminates.
 *
 * Seeds itself from the corpus, which records every call that was created, and
 * says plainly that the requests REFUSED before a call existed are not in the
 * corpus, because a refused request produces no call object to save. That gap
 * is the reason no hypothesis can be eliminated yet, and naming it is the point:
 * a ledger that cannot see every request cannot audit the counter.
 */

import { readFileSync, rmSync } from "node:fs";
import { Ledger, type RequestKind } from "./ledger.js";

const lima = (d: Date) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(d);

type IndexEntry = { file: string; status: string; failureCode: string | null; turns: number };
const index = JSON.parse(readFileSync("fixtures/index.json", "utf8")) as { calls: IndexEntry[] };

// The report is a projection of the corpus, not a running record, so it starts
// from nothing on every run. Accumulating across runs would double-count.
const REPORT_PATH = ".calle-ledger-report.json";
rmSync(REPORT_PATH, { force: true });
const ledger = new Ledger(REPORT_PATH);

for (const call of index.calls) {
  const kind: RequestKind = call.turns > 0 ? "placed_connected" : "placed_unconnected";
  ledger.record({ kind, callId: call.file, attemptsReported: 1, note: `seeded from corpus (${call.status})` });
}

const observed = new Ledger().observations.at(-1) ?? { at: new Date().toISOString(), count: 20, limit: 20, windowHours: 24 };
ledger.observe(observed);

const { reading, rows } = ledger.reconcile(false);

process.stdout.write(`\nCalls the corpus can account for: ${index.calls.length}\n`);
if (reading !== null) {
  process.stdout.write(`Counter last read at ${lima(new Date(reading.at))} (Lima): ${reading.count} of ${reading.limit}, window ${reading.windowHours}h\n`);
}
process.stdout.write(`\n${"hypothesis".padEnd(22)} ${"predicts".padStart(8)} ${"drift".padStart(6)}   status\n`);
process.stdout.write(`${"-".repeat(22)} ${"-".repeat(8)} ${"-".repeat(6)}   ${"-".repeat(40)}\n`);
for (const r of rows) {
  const status = r.survives === null ? "cannot judge, ledger incomplete" : r.survives ? "survives" : "eliminated";
  process.stdout.write(`${r.id.padEnd(22)} ${String(r.predicted).padStart(8)} ${String(r.drift ?? "-").padStart(6)}   ${status}\n`);
}
process.stdout.write(`\n`);
for (const r of rows) process.stdout.write(`  ${r.id}\n      ${r.describes}\n`);

process.stdout.write(`
Why nothing is eliminated yet. The corpus holds a payload for every call that
was created, and nothing for the requests refused before a call existed, because
a refusal produces no object to save. Those refusals are the difference between
${rows[1]?.predicted ?? 0} and ${reading?.count ?? 0}, and until a run records every request as it is
made, the drift is unattributed rather than measured.

The measurement run does record them, in order and from an empty window.
`);
