/**
 * How much capacity came back, and does a refused request consume any?
 *
 * The counter released capacity 24 hours after the first request of the previous
 * window, which rules out a fixed daily reset but leaves two shapes standing:
 * units returning one at a time, or the whole allowance returning at once.
 *
 * Both are settled by the same measurement. Issue requests that reach the
 * planner and are refused there, one at a time, until the limiter answers. No
 * call is placed by any of them, because the destination region is unsupported.
 *
 *   stops after 1 refusal    one unit returned, and a refused request consumes
 *   stops after N refusals   N units were available, and a refused request consumes
 *   never stops              a refused request consumes nothing
 *
 * Bounded so the third outcome ends rather than running forever.
 */

import { CalleClient } from "@call-e/calle";
import { writeFile } from "node:fs/promises";
import { Ledger } from "./ledger.ts";
import { unsupportedDestination } from "./unsupported-destination.ts";

const CEILING = 25;

const lima = (d: Date) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", timeStyle: "medium" }).format(d);

const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY ?? "" });
const ledger = new Ledger();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const log: Array<{ n: number; at: string; status?: number; code?: string; details?: unknown }> = [];

process.stdout.write(`Issuing refused requests until the limiter answers, ceiling ${CEILING}.\n`);
process.stdout.write(`None of them places a call: the destination region is unsupported.\n\n`);

let refusals = 0;
let capped: Record<string, unknown> | null = null;

for (let n = 1; n <= CEILING; n += 1) {
  const at = new Date();
  try {
    await client.calls.create(
      {
        task: "Ask whether the person can hear the call clearly, thank them, and end the call.",
        recipients: [unsupportedDestination()],
        recipientResultSchema: {
          type: "object",
          required: ["heard_clearly"],
          properties: { heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] } },
          additionalProperties: false,
        },
        metadata: { probe: "headroom", run: runId },
      },
      { idempotencyKey: `headroom-${runId}-${n}` },
    );
    process.stdout.write(`${String(n).padStart(2)}  ${lima(at)}  ACCEPTED, which an unsupported region should not allow\n`);
    log.push({ n, at: at.toISOString(), code: "accepted" });
    break;
  } catch (error) {
    const e = error as Error & { code?: string; status?: number; details?: Record<string, unknown> };
    log.push({ n, at: at.toISOString(), status: e.status, code: e.code, details: e.details ?? null });

    if (e.code === "rate_limit_exceeded") {
      capped = e.details ?? {};
      process.stdout.write(`${String(n).padStart(2)}  ${lima(at)}  CAPPED. ${JSON.stringify(capped)}\n`);
      break;
    }
    refusals += 1;
    ledger.record({ kind: "rejected_planner", callId: null, attemptsReported: 0, note: `headroom probe ${n}` });
    process.stdout.write(`${String(n).padStart(2)}  ${lima(at)}  refused at the planner: ${e.status} ${e.code}\n`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

const path = `probe-results/EVIDENCE-headroom-${runId}.json`;
await writeFile(path, JSON.stringify({ captured: new Date().toISOString(), refusals, capped, log }, null, 2), "utf8");

process.stdout.write(`\nrefusals accepted before the limiter answered: ${refusals}\n`);
if (capped !== null) {
  ledger.observe({ count: Number(capped.count), limit: Number(capped.limit), windowHours: Number(capped.window_hours) });
  process.stdout.write(
    refusals === 1
      ? `reading: one unit had returned, and a request refused at the planner consumes it.\n`
      : `reading: ${refusals} units were available, and a request refused at the planner consumes one each.\n`,
  );
} else {
  process.stdout.write(`reading: ${CEILING} refused requests consumed nothing. Refusals are not metered.\n`);
}
process.stdout.write(`\nSaved to ${path}\n`);
