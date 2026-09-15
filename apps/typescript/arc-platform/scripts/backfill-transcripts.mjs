/**
 * Put transcripts on calls recorded before we kept them.
 *
 *   node scripts/backfill-transcripts.mjs          # report
 *   node scripts/backfill-transcripts.mjs --apply
 *
 * Reads each call back from CALL-E once and stores its turns on our row, so
 * the plan's "heard here" link works for calls that already happened. Only
 * touches rows whose transcript is null; never overwrites one we hold.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { prisma } = await jiti.import(path.join(root, "lib/db.ts"));
const { resolveCalleBaseUrl } = await jiti.import(path.join(root, "lib/calle.ts"));
const { Prisma } = await import(path.join(root, "node_modules/@prisma/client/index.js"));
const { CalleClient } = await import(path.join(root, "node_modules/@call-e/calle/dist/index.js"));
const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY,
  /* Through the allowlist. This script builds its own client, so the check
     in lib/calle.ts never ran for it. */
  baseUrl: resolveCalleBaseUrl(process.env.CALLE_BASE_URL),
});

const apply = process.argv.includes("--apply");
const rows = await prisma.call.findMany({
  /* Prisma.DbNull, not null: on a Json column `equals: null` means "the JSON
     value null", not "no value", and it silently matched nothing. Same family
     as `not: true` on a nullable boolean matching no rows. */
  where: { calleCallId: { not: null }, transcript: { equals: Prisma.DbNull }, mock: false },
  select: { id: true, calleCallId: true, targetName: true },
  orderBy: { createdAt: "desc" },
});
console.log(`${rows.length} call(s) with no stored transcript\n`);

let filled = 0;
for (const r of rows) {
  try {
    const call = await client.calls.get(r.calleCallId);
    const a = call.recipients?.[0]?.attempts?.slice(-1)[0];
    const turns = (a?.transcriptTurns ?? []).map((t) => ({
      at: t.offset_seconds ?? null,
      speaker: t.speaker ?? "bot",
      text: (t.text ?? "").trim(),
    }));
    console.log(`  ${r.calleCallId.padEnd(30)} ${String(r.targetName).padEnd(18)} ${turns.length} turns`);
    if (apply && turns.length) {
      await prisma.call.update({ where: { id: r.id }, data: { transcript: turns } });
      filled++;
    }
  } catch (e) {
    console.log(`  ${r.calleCallId}: ${e.message}`);
  }
}
console.log(apply ? `\nfilled ${filled}` : "\nNothing changed. Re-run with --apply.");
await prisma.$disconnect();
