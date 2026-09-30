/**
 * Fill the Contact table — the numbers Arc is allowed to dial.
 *
 *   node_modules/.bin/jiti scripts/seed-contacts.ts                 # from the catalogue
 *   node_modules/.bin/jiti scripts/seed-contacts.ts --csv real.csv  # from your own data
 *   node_modules/.bin/jiti scripts/seed-contacts.ts --phone +923005550000
 *
 * Idempotent: every row is an upsert on `externalId`, so running it twice
 * changes nothing and re-running after editing the CSV updates in place.
 *
 * IT NEVER INVENTS A NUMBER. Seeding from the catalogue writes contacts with
 * `phone: null`, which is what makes a card say NO PHONE - the honest state
 * for a station whose desk we do not have permission to ring. A number only
 * arrives when you pass --phone or put one in the CSV, and anything set that
 * way is marked `isDemoContact` unless the CSV says otherwise: a number of
 * ours standing in for a real desk must never be mistaken for the desk's own
 * line.
 *
 * CSV columns (header required, order free, unknown columns ignored). Both
 * camelCase and the snake_case a spreadsheet export gives you are accepted,
 * because the alternative is somebody hand-renaming headers and mistyping one:
 *   externalId | catalogue_id      name      type      channel   city
 *   frequency  | frequency_mhz     owner
 *   audience | audience_daily | followers      audience_basis (else derived
 *                                                 from type)
 *   handle     category | genre     rateEstimatePkr | rate_estimate_pkr
 *   phone      isDemoContact | is_demo_contact     notes
 *   - type is station | creator (or STATION | CREATOR)
 *   - phone must be E.164; a row with a malformed one is reported and skipped
 *     rather than stored, because a bad number in this table would be dialled
 */
import { readFileSync } from "node:fs";

import { prisma } from "../lib/db";
import { STATIONS } from "../app/radio/_data";
import { CREATORS } from "../app/influencers/_data";

const isE164 = (p: string) => /^\+[1-9]\d{7,14}$/.test(p);

interface Row {
  externalId: string;
  name: string;
  type: "STATION" | "CREATOR";
  channel?: string | null;
  city?: string | null;
  frequency?: string | null;
  owner?: string | null;
  handle?: string | null;
  category?: string | null;
  audience?: number | null;
  audienceBasis?: string | null;
  rateEstimatePkr?: number | null;
  phone?: string | null;
  isDemoContact?: boolean;
  notes?: string | null;
}

/** The catalogue, as contacts, with no numbers attached. */
function fromCatalogue(): Row[] {
  return [
    ...STATIONS.map((s): Row => ({
      externalId: s.id,
      name: s.name,
      type: "STATION",
      channel: "radio",
      city: s.city,
      frequency: s.frequency,
      audience: s.dailyListeners,
      audienceBasis: "daily listeners",
      rateEstimatePkr: s.priceMin,
    })),
    ...CREATORS.map((c): Row => ({
      externalId: c.id,
      name: c.displayName,
      type: "CREATOR",
      channel: c.primaryPlatform,
      city: c.city,
      handle: `@${c.username}`,
      category: c.niche.join(", "),
      audience: c.followers,
      audienceBasis: "followers",
      rateEstimatePkr: c.pricePost,
    })),
  ];
}

/* Deliberately small rather than a dependency: quoted fields with commas are
   supported, everything else is a split. If the real data needs more than
   this, it needs a real parser rather than a cleverer regex. */
function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const cells = (line: string) =>
    (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [])
      .map((c) => c.replace(/,$/, "").trim().replace(/^"|"$/g, "").replace(/""/g, '"'))
      .slice(0, -1);

  const header = cells(lines[0]).map((h) => h.trim());
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const v = cells(line);
    /* First header that exists wins, so a spreadsheet export and a hand-written
       file both work without anyone renaming columns. */
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const i = header.indexOf(k);
        if (i !== -1) return (v[i] ?? "").trim();
      }
      return "";
    };
    const externalId = get("externalId", "catalogue_id", "id");
    if (!externalId) continue;
    /* Empty stays null. An audience or a rate nobody supplied is not zero, and
       a zero here would render as a real figure on a plan. */
    const num = (...keys: string[]) => {
      const raw = get(...keys);
      const n = Number(raw);
      return raw !== "" && Number.isFinite(n) ? Math.round(n) : null;
    };
    const freq = get("frequency", "frequency_mhz");
    rows.push({
      externalId,
      name: get("name") || externalId,
      type: /creator/i.test(get("type")) ? "CREATOR" : "STATION",
      channel: get("channel") || null,
      city: get("city") || null,
      /* "100.0" from a spreadsheet becomes "100.0 MHz"; an already-formatted
         value is left alone. */
      frequency: freq ? (/[a-z]/i.test(freq) ? freq : `${freq} MHz`) : null,
      owner: get("owner") || null,
      handle: get("handle") || null,
      category: get("category", "genre") || null,
      /* Two files, two names for the same column, and they do not mean the
         same thing - so the basis is recorded beside the number rather than
         inferred later by whatever screen renders it. */
      audience: num("audience", "audience_daily", "followers"),
      audienceBasis:
        get("audience_basis") ||
        (/creator/i.test(get("type")) ? "followers" : "daily listeners"),
      rateEstimatePkr: num("rateEstimatePkr", "rate_estimate_pkr"),
      phone: get("phone") || null,
      isDemoContact: /^(true|yes|1)$/i.test(get("isDemoContact", "is_demo_contact")),
      notes: get("notes") || null,
    });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args[args.indexOf("--csv") + 1];
  const phoneAll = args.includes("--phone") ? args[args.indexOf("--phone") + 1] : null;

  if (phoneAll && !isE164(phoneAll)) {
    console.error(`--phone ${phoneAll} is not E.164 (+ country code, 8-15 digits). Nothing written.`);
    process.exit(1);
  }

  const rows = args.includes("--csv")
    ? parseCsv(readFileSync(csvPath, "utf8"))
    : fromCatalogue();

  if (!rows.length) {
    console.error("No rows to seed.");
    process.exit(1);
  }

  let written = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    const phone = r.phone?.trim() || phoneAll || null;
    if (phone && !isE164(phone)) {
      /* Reported and skipped rather than stored: a malformed number in this
         table is one somebody would try to dial. */
      skipped.push(`${r.externalId}: "${phone}" is not E.164`);
      continue;
    }
    const data = {
      name: r.name,
      type: r.type,
      channel: r.channel ?? null,
      city: r.city ?? null,
      frequency: r.frequency ?? null,
      owner: r.owner ?? null,
      handle: r.handle ?? null,
      category: r.category ?? null,
      audience: r.audience ?? null,
      /* Only meaningful when there is a number to describe. */
      audienceBasis: r.audience == null ? null : (r.audienceBasis ?? null),
      rateEstimatePkr: r.rateEstimatePkr ?? null,
      phone,
      /* A number that came from --phone is ours by definition. One from the
         CSV is whatever the CSV said. */
      isDemoContact: phone ? (r.isDemoContact ?? Boolean(phoneAll)) : false,
      notes: r.notes ?? null,
    };
    await prisma.contact.upsert({
      where: { externalId: r.externalId },
      create: { externalId: r.externalId, ...data },
      update: data,
    });
    written++;
  }

  const withPhone = await prisma.contact.count({ where: { phone: { not: null } } });
  const total = await prisma.contact.count();
  console.log(`upserted ${written} contact${written === 1 ? "" : "s"}` +
    (args.includes("--csv") ? ` from ${csvPath}` : " from the catalogue"));
  if (skipped.length) console.log("skipped:\n  " + skipped.join("\n  "));
  console.log(`${withPhone} of ${total} contacts have a number; the rest show NO PHONE and are not dialled.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("seed failed:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
