/**
 * Restore a logical backup taken by the pre-migration dump.
 *
 *   node --env-file=.env.local scripts/restore-backup.mjs .backups/<file>.json
 *
 * Inserts rows back in dependency order (Brand -> BrandUser/Campaign/Booking)
 * and skips any id that already exists, so it is safe to run twice. It does NOT
 * delete anything: restoring into a database that still holds rows merges
 * rather than replaces. To restore onto a clean database, recreate the schema
 * first (prisma migrate deploy) and run this against the empty tables.
 *
 * Booking is included only for backups taken before that model was dropped;
 * it is skipped automatically when the client no longer has it.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node --env-file=.env.local scripts/restore-backup.mjs <backup.json>");
  process.exit(1);
}

const db = new PrismaClient();
const dump = JSON.parse(readFileSync(file, "utf8"));
console.log(`Restoring ${file} (taken ${dump.takenAt})`);

const ORDER = ["Brand", "BrandUser", "Campaign", "Booking"];
const MODEL = { Brand: "brand", BrandUser: "brandUser", Campaign: "campaign", Booking: "booking" };

for (const table of ORDER) {
  const rows = dump.tables[table] ?? [];
  const model = db[MODEL[table]];
  if (!model) {
    console.log(`  ${table}: skipped (model no longer exists in this schema)`);
    continue;
  }
  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const data = { ...row };
    for (const k of Object.keys(data)) {
      if (typeof data[k] === "string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(data[k])) data[k] = new Date(data[k]);
    }
    try {
      await model.create({ data });
      inserted++;
    } catch (err) {
      if (err.code === "P2002" || err.code === "P2003") skipped++;
      else throw err;
    }
  }
  console.log(`  ${table}: ${inserted} inserted, ${skipped} skipped (already present)`);
}

await db.$disconnect();
console.log("Done.");
