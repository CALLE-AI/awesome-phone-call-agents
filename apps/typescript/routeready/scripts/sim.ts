// Runs the demo day twice with no network and no real calls: once the way
// riders work today (no calls ahead), once with RouteReady calling ahead
// through scripted customers. Prints the adaptive day and a comparison.
// Usage: npm run sim [-- fixtures/day-dhaka.json]
import { DEFAULT_DAY, loadDay } from "../src/core/day.js";
import { minutesToClock } from "../src/core/readiness.js";
import { ScriptedPort } from "../src/calle/ports.js";
import { describeEvent } from "../src/engine/describe.js";
import { runDay, type RouteEngine } from "../src/engine/engine.js";

const { day, travel } = loadDay(process.argv[2] ?? DEFAULT_DAY);
const port = new ScriptedPort(new Map(day.stops.map((stop) => [stop.id, stop])), day.truth, day.merchant);

const baseline = await runDay({ day, travel, runId: "sim-baseline" });
const adaptive = await runDay({
  day,
  travel,
  runId: "sim-adaptive",
  routeCall: (stop) => ({ port, target: { phone: stop.phone, region: "BD" } }),
});

const clock = (minutes: number) => minutesToClock(minutes, day.shiftStart);

console.log(`RouteReady simulated day: ${day.city}, ${day.stops.length} stops, shift starts ${day.shiftStart}`);
console.log("Scripted customers only. No network, no real calls.\n");
for (const event of adaptive.events) {
  const text = describeEvent(event, day);
  if (text) console.log(`  ${clock(event.at)}  ${event.type === "call_line" ? "    " : ""}${text}`);
}

console.log("\nSame day, two ways:\n");
printTable([
  ["", "Without calls", "With RouteReady"],
  ["Delivered", ...both((e) => `${e.metrics.delivered}`)],
  ["Failed attempts at the door", ...both((e) => `${e.metrics.failedAttempts}`)],
  ["Minutes waiting at doors", ...both((e) => e.metrics.doorWaitMinutes.toFixed(0))],
  ["Trips avoided (later / not today)", ...both((e) => `${e.metrics.tripsAvoided}`)],
  ["Calls placed", ...both((e) => `${e.metrics.calls}`)],
  ["Call cost at $0.05 each", ...both((e) => `$${(e.metrics.calls * 0.05).toFixed(2)}`)],
  ["Kilometres driven", ...both((e) => e.metrics.kilometres.toFixed(1))],
  ["Route finished", ...both((e) => (e.metrics.finishedAt === null ? "-" : clock(e.metrics.finishedAt)))],
]);

function both(read: (engine: RouteEngine) => string): [string, string] {
  return [read(baseline), read(adaptive)];
}

function printTable(rows: string[][]): void {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) console.log(`  ${row.map((cell, column) => cell.padEnd(widths[column])).join("   ")}`);
}
