/**
 * Retire the eight hand-written creators.
 *
 *   node scripts/retire-handwritten-creators.mjs
 *   node scripts/retire-handwritten-creators.mjs --apply
 *
 * They had real-looking handles - @zarakhan_official, @pakistanfoodielife,
 * @cricket_talks_pk - with follower counts, engagement rates, per-post prices
 * and testimonials, and nothing anywhere recorded whether those accounts
 * belong to real people. If they were invented, removing them costs nothing.
 * If even one was real, the product was publishing a person's commercial terms
 * without their knowledge. The risk is one-sided.
 *
 * Deleted rather than hidden: a hidden row is still a row a query can find.
 * Calls already placed keep their own copy of the name, so call history and
 * transcripts survive - those calls did happen.
 *
 * It refuses if any plan line still references one, because that would be a
 * campaign losing a line rather than the catalogue losing a persona.
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

const RETIRE = [
  "sanalifestyle_pk", "nadiakitchenette", "ayesha_tariq_style", "pakistanfoodielife",
  "healthymama_pk", "zarakhan_official", "cricket_talks_pk", "islamicreminders_daily",
];
const apply = process.argv.includes("--apply");

const blocking = await prisma.mediaPlanItem.findMany({
  where: { externalId: { in: RETIRE } },
  select: { id: true, name: true, campaignId: true },
});
if (blocking.length) {
  console.error(`${blocking.length} plan line(s) still reference these. Refusing:`);
  for (const b of blocking) console.error(`  ${b.name} in campaign ${b.campaignId}`);
  process.exit(2);
}

const found = await prisma.contact.findMany({
  where: { externalId: { in: RETIRE } },
  select: { externalId: true, name: true, handle: true },
});
console.log(`${found.length} of ${RETIRE.length} present in the catalogue:\n`);
for (const c of found) console.log(`  ${c.externalId.padEnd(24)} ${String(c.name).padEnd(16)} ${c.handle ?? ""}`);

if (apply) {
  const r = await prisma.contact.deleteMany({ where: { externalId: { in: RETIRE } } });
  console.log(`\ndeleted ${r.count}. Calls already placed keep their own copy of the name.`);
} else {
  console.log("\nNothing changed. Re-run with --apply.");
}

const left = await prisma.contact.count({ where: { type: "CREATOR" } });
console.log(`creators remaining: ${left}`);
await prisma.$disconnect();
