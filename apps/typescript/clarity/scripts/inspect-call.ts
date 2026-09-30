/**
 * Re-reads a call that already happened, without placing a new one.
 *
 *   npm run call:inspect -- call_abc123
 *   npm run call:inspect -- data/captures/2026-08-27T....json
 */
import { promises as fs } from "node:fs";
import { calleClient } from "../lib/calle";
import { formatOffset, normalizeCall } from "../lib/call-record";

const target = process.argv[2];
if (!target) {
  console.error("Usage: npm run call:inspect -- <call_id | path/to/run.json>");
  process.exit(1);
}

const call = target.endsWith(".json")
  ? JSON.parse(await fs.readFile(target, "utf8"))
  : await calleClient().calls.get(target);

const record = normalizeCall(call);
console.log(JSON.stringify(record, null, 2));
console.log("\n--- transcript ---");
for (const turn of record.transcript) {
  console.log(`[${formatOffset(turn.offsetSeconds) ?? "--:--"}] ${turn.speaker}: ${turn.text}`);
}
