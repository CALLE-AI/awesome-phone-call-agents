/**
 * Close out calls the scheduled sweep can no longer see.
 *
 *   node scripts/reconcile-stuck.mjs          # report only
 *   node scripts/reconcile-stuck.mjs --apply  # write what CALL-E says
 *
 * THERE IS NO WAY TO CANCEL A CALL. /v1/calls is POST-only and
 * /v1/calls/{id} is GET-only in the OpenAPI schema - no DELETE, no PATCH, and
 * the SDK exposes only create, get, listEvents, waitForResult, createAndWait.
 * So nothing here reaches out and stops anything; a call already placed will
 * run its course at CALL-E whatever this script does.
 *
 * What it does fix is OUR record. The reconcile cron only looks at calls
 * between 2 minutes and 24 hours old, so a call that fell outside that window
 * once is never examined again and stays "in flight" forever. Six had. All six
 * had long since finished at CALL-E, and three of them had COMPLETED - real
 * results, never read, because the row still said queued.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { prisma } = await jiti.import(path.join(root, "lib/db.ts"));
const { sweep } = await jiti.import(path.join(root, "lib/reconcile.ts"));
const { calleGetCall } = await jiti.import(path.join(root, "lib/calle.ts"));

const apply = process.argv.includes("--apply");

const stuck = await prisma.call.findMany({
  where: { done: false, mock: false, calleCallId: { not: null } },
  orderBy: { createdAt: "asc" },
  select: { calleCallId: true, targetName: true, status: true, createdAt: true },
});

if (!stuck.length) {
  console.log("Nothing is stuck. Every call with a CALL-E id is done.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`${stuck.length} call(s) our record still calls unfinished:\n`);
for (const c of stuck) {
  let real = "unreadable";
  try {
    const s = await calleGetCall(c.calleCallId);
    real = `${s.status}${s.done ? "" : " (genuinely still running)"}${s.transcriptTurns ? `, ${s.transcriptTurns} turns` : ""}`;
  } catch (e) {
    real = `error: ${e.message}`;
  }
  console.log(
    `  ${c.calleCallId.padEnd(30)} ${String(c.targetName).padEnd(24)} ` +
    `ours="${c.status}"  CALL-E="${real}"`
  );
}

if (!apply) {
  console.log("\nNothing was changed. Re-run with --apply to write CALL-E's answer into the record.");
  await prisma.$disconnect();
  process.exit(0);
}

/* No age ceiling: that ceiling is the reason these were stranded. A larger
   batch than the cron's, because this is a one-off catch-up rather than a
   five-minute slice. */
const r = await sweep({ maxAgeMs: Infinity, batch: 200 });
console.log(`\nresolved ${r.resolved}, still running ${r.stillRunning}` + (r.errors?.length ? `, errors: ${r.errors.join("; ")}` : ""));
await prisma.$disconnect();
