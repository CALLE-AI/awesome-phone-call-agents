/**
 * Watches the quota counter to find out how it refills.
 *
 * The platform states `window_hours: 24` in its own error payload. That is a
 * claim, not a measurement, and this whole project exists because a claim from
 * the system under test is not evidence. Two refill shapes fit the same claim:
 *
 *   rolling   units return one at a time, each 24h after it was spent
 *   daily     the counter drops to zero at one fixed instant
 *
 * They look different while they happen, so watching is enough to tell them
 * apart. Reading costs nothing WHILE AT THE CAP, because the limiter rejects
 * the probe before it reaches the planner. The moment headroom exists, the same
 * probe reaches the planner and may consume a unit. So this stops at the first
 * observed drop rather than continuing to sample.
 *
 * Places no call at any point.
 */

import { CalleClient } from "@call-e/calle";
import { Ledger } from "./ledger.js";
import { unsupportedDestination } from "./unsupported-destination.js";

const POLL_MS = 10 * 60 * 1000;
const MAX_HOURS = 6;

const lima = (d: Date) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "medium" }).format(d);

const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY ?? "" });
const ledger = new Ledger();

async function peek(): Promise<{ atCap: boolean; count?: number; limit?: number; windowHours?: number; note: string }> {
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
        metadata: { probe: "watch" },
      },
      { idempotencyKey: `watch-${Date.now()}` },
    );
    return { atCap: false, note: "the create was ACCEPTED, which an unsupported region should not allow" };
  } catch (error) {
    const e = error as Error & { code?: string; status?: number; details?: Record<string, unknown> };
    if (e.code === "rate_limit_exceeded") {
      const d = e.details ?? {};
      return { atCap: true, count: Number(d.count), limit: Number(d.limit), windowHours: Number(d.window_hours), note: "at the cap" };
    }
    return { atCap: false, note: `headroom exists, the probe reached the planner: ${e.status} ${e.code}` };
  }
}

const startedAt = Date.now();
process.stdout.write(`watching from ${lima(new Date())} (Lima). Polling every ${POLL_MS / 60000} min.\n`);
process.stdout.write(`Stops at the first drop, because probing is only free while at the cap.\n\n`);

let previous: number | null = null;

for (;;) {
  const reading = await peek();
  const now = new Date();

  if (!reading.atCap) {
    process.stdout.write(`${lima(now)}  HEADROOM. ${reading.note}\n`);
    process.stdout.write(`\nThe counter released capacity between the previous poll and now.\n`);
    if (previous !== null) process.stdout.write(`Last reading while capped: ${previous}.\n`);
    process.stdout.write(`Stopping so no further probe spends a unit.\n`);
    ledger.record({ kind: "rejected_planner", callId: null, attemptsReported: 0, note: "watch probe after headroom appeared" });
    break;
  }

  const count = reading.count ?? -1;
  if (count !== previous) {
    ledger.observe({ count, limit: reading.limit ?? 20, windowHours: reading.windowHours ?? 24 });
    process.stdout.write(`${lima(now)}  count ${count} of ${reading.limit}${previous === null ? "" : `   (was ${previous})`}\n`);
    previous = count;
  } else {
    process.stdout.write(`${lima(now)}  count ${count}, unchanged\n`);
  }

  if (Date.now() - startedAt > MAX_HOURS * 3600_000) {
    process.stdout.write(`\nStopping after ${MAX_HOURS}h with no drop observed.\n`);
    break;
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

process.stdout.write(`\nobservations recorded: ${ledger.observations.length}\n`);
for (const o of ledger.observations) process.stdout.write(`  ${lima(new Date(o.at))}  ${o.count}/${o.limit}\n`);
