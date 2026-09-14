/**
 * One network, one spelling.
 *
 *   node scripts/normalise-names.mjs          # report only
 *   node scripts/normalise-names.mjs --apply  # rename
 *
 * The catalogue carried "City FM 89" for Karachi (from app/radio/_data.ts) and
 * "CityFM89" for Lahore, Islamabad and Faisalabad (from the CSV import). Same
 * network, two spellings, sorted next to each other in the directory - which
 * reads as two brands to anyone looking at the screen.
 *
 * It also REPORTS any other name that appears in more than one spelling, by
 * comparing names with case, spaces and punctuation stripped. Those are listed
 * and left alone: deciding which spelling is correct is a judgement about a
 * real company, not something a script should guess at.
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

/** Decided by a person, not inferred. */
const CANONICAL = [{ from: "CityFM89", to: "City FM 89" }];

const apply = process.argv.includes("--apply");
const rows = await prisma.contact.findMany({
  select: { externalId: true, name: true, city: true },
  orderBy: { name: "asc" },
});

let renamed = 0;
for (const { from, to } of CANONICAL) {
  const hits = rows.filter((r) => r.name === from);
  for (const h of hits) {
    console.log(`${apply ? "renaming" : "would rename"}: ${h.externalId} (${h.city})  "${from}" -> "${to}"`);
    if (apply) await prisma.contact.update({ where: { externalId: h.externalId }, data: { name: to } });
    renamed++;
  }
}

/* Anything else spelled two ways. Reported, never guessed at. */
const key = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
const groups = new Map();
for (const r of rows) {
  const k = key(apply ? (CANONICAL.find((c) => c.from === r.name)?.to ?? r.name) : r.name);
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
const split = [...groups.values()].filter((g) => new Set(g.map((x) => x.name)).size > 1);
if (split.length) {
  console.log(`\nOther names spelled more than one way - decide, then add to CANONICAL:`);
  for (const g of split) {
    console.log(`  ${[...new Set(g.map((x) => x.name))].join("  vs  ")}  ->  ${g.map((x) => `${x.externalId} (${x.city})`).join(", ")}`);
  }
} else {
  console.log(`\nNo other name is spelled more than one way across ${rows.length} contacts.`);
}

console.log(apply ? `\nrenamed ${renamed}` : `\nwould rename ${renamed}. Nothing was changed; re-run with --apply.`);
await prisma.$disconnect();
