/**
 * The last N calls we placed, from our own database.
 *
 *   set -a; . ./.env.local; set +a
 *   node_modules/.bin/jiti scripts/recent-calls.ts        # last 10
 *   node_modules/.bin/jiti scripts/recent-calls.ts 25     # last 25
 *
 * Exists because recovering a call afterwards needs its id, and the id used to
 * live in exactly two places - the API response and React state - so closing
 * the tab lost it. Three transcripts went that way. CALL-E cannot help either:
 * `/v1/calls` is POST-only, there is no list endpoint, and provider ids are
 * not addressable, so a call whose id you have lost is gone for good.
 *
 * Reads. Writes nothing. Prints the id in a form you can paste straight into
 * the reader:
 *
 *   node_modules/.bin/jiti scripts/ab-mandate-call.ts --fetch <id>
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

async function main() {
  const take = Number(process.argv[2]) || 10;

  const calls = await db.call.findMany({
    orderBy: { createdAt: "desc" },
    take,
    select: {
      calleCallId: true,
      targetName: true,
      targetType: true,
      status: true,
      outcome: true,
      done: true,
      mock: true,
      pricePkr: true,
      rateConfirmed: true,
      createdAt: true,
    },
  });

  if (!calls.length) {
    console.log("No calls on record yet.");
    return;
  }

  console.log(
    /* The id column is wide enough for a whole id on purpose: a truncated id
       cannot be copied, and copying it is the only reason this column exists. */
    `${pad("created (UTC)", 21)}${pad("call id", 29)}${pad("target", 26)}` +
    `${pad("status", 12)}${pad("outcome", 15)}rate`
  );
  console.log("-".repeat(100));

  for (const c of calls) {
    /* A simulated call is marked, always and everywhere - a row that never
       touched a phone must never read like one that did. */
    const name = c.targetName + (c.mock ? " (sim)" : "");
    const rate =
      c.pricePkr == null
        ? "—"
        : `PKR ${c.pricePkr.toLocaleString()}` +
          /* null is "the call did not say", which is not "they refused". */
          (c.rateConfirmed === true ? "" : c.rateConfirmed === false ? " unconfirmed" : " (unknown)");

    console.log(
      pad(c.createdAt.toISOString().slice(0, 19).replace("T", " "), 21) +
      pad(c.calleCallId ?? "(none)", 29) +
      pad(`${name} · ${c.targetType.toLowerCase()}`, 26) +
      pad(c.status, 12) +
      pad(String(c.outcome ?? (c.done ? "done" : "in flight")), 15) +
      rate
    );
  }

  const ids = calls.map((c) => c.calleCallId).filter(Boolean).slice(0, 2);
  if (ids.length) {
    console.log(`\nRead the newest back:\n  node_modules/.bin/jiti scripts/ab-mandate-call.ts --fetch ${ids.join(" ")}`);
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
