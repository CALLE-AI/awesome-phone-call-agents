/**
 * Junk campaign names, off the screen.
 *
 *   node scripts/tidy-campaign-names.mjs <brandId>
 *   node scripts/tidy-campaign-names.mjs <brandId> --apply
 *
 * The backup transcript beat is filmed in Coactal, whose campaigns list reads
 * "Tan / New Pro / kkk / kkk / 1 / test". Those are real rows a real person
 * created while testing, so they are ARCHIVED rather than deleted - the calls
 * and plan lines hanging off them stay intact and stay reachable, they simply
 * stop leading the list.
 *
 * A campaign is junk if its name is one or two characters, is a known test
 * word, or is all digits. Anything else is left alone and reported.
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

const brandId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!brandId) { console.error("Usage: tidy-campaign-names.mjs <brandId> [--apply]"); process.exit(1); }

const JUNK = /^(test|testing|asdf|qwerty|abc|xyz|kkk+|new pro|untitled)$/i;
const isJunk = (n) => {
  const t = n.trim();
  return t.length <= 2 || /^\d+$/.test(t) || JUNK.test(t);
};

const campaigns = await prisma.campaign.findMany({
  where: { brandId },
  orderBy: { createdAt: "desc" },
  select: { id: true, name: true, status: true, _count: { select: { items: true } } },
});

const junk = campaigns.filter((c) => isJunk(c.name) && c.status !== "ARCHIVED");
const keep = campaigns.filter((c) => !isJunk(c.name));

console.log(`${campaigns.length} campaign(s) in this workspace\n`);
console.log("KEEPING:");
for (const c of keep) console.log(`  "${c.name}"  ${c.status}  ${c._count.items} line(s)`);
console.log(`\n${apply ? "ARCHIVING" : "WOULD ARCHIVE"}:`);
for (const c of junk) console.log(`  "${c.name}"  ${c.status}  ${c._count.items} line(s)  ${c.id}`);

if (apply && junk.length) {
  await prisma.campaign.updateMany({ where: { id: { in: junk.map((c) => c.id) } }, data: { status: "ARCHIVED" } });
  console.log(`\narchived ${junk.length} - their calls and plan lines are untouched`);
} else if (!apply) {
  console.log("\nNothing changed. Re-run with --apply.");
}
await prisma.$disconnect();
