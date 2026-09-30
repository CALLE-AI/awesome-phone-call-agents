/**
 * Replace generated station figures with real ones.
 *
 *   node scripts/import-station-facts.mjs                    # report
 *   node scripts/import-station-facts.mjs --apply
 *   node scripts/import-station-facts.mjs --csv path.csv --apply
 *
 * Reads docs/arc-station-facts.csv. Only non-empty cells are written, so a
 * half-filled row is fine and safe: leave a column blank and whatever is there
 * now is left alone.
 *
 * Anything imported here is marked as real. The generated profile's figures are
 * overwritten by the ones you supply, and `source` is stored alongside so the
 * provenance of a number survives the person who typed it - which is the whole
 * argument this product makes about rates.
 *
 * It refuses an unknown external_id rather than creating a station: the
 * catalogue is the catalogue, and a typo should not quietly add a transmitter.
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

const apply = process.argv.includes("--apply");
const ci = process.argv.indexOf("--csv");
const csvPath = path.resolve(root, ci > -1 ? process.argv[ci + 1] : "docs/arc-station-facts.csv");

/* Small CSV reader: quoted fields with commas inside, nothing more exotic. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const [header, ...lines] = parseCsv(fs.readFileSync(csvPath, "utf8"));
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const need = ["external_id"];
for (const n of need) if (!(n in col)) { console.error(`CSV is missing a "${n}" column.`); process.exit(1); }

const val = (r, name) => (col[name] === undefined ? "" : (r[col[name]] ?? "").trim());
const num = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

let changed = 0, skipped = 0;
for (const r of lines) {
  const id = val(r, "external_id");
  if (!id) continue;
  const contact = await prisma.contact.findUnique({ where: { externalId: id } });
  if (!contact) { console.log(`  ?  ${id} — not in the catalogue, skipped`); skipped++; continue; }

  const data = {};
  const set = (k, v) => { if (v !== null && v !== "" && v !== undefined) data[k] = v; };
  set("name", val(r, "name"));
  set("city", val(r, "city"));
  set("frequency", val(r, "frequency"));
  set("owner", val(r, "owner"));
  set("category", val(r, "format"));
  set("audience", num(val(r, "daily_listeners")));
  set("rateEstimatePkr", num(val(r, "rate_per_spot_pkr")));
  if (data.audience) data.audienceBasis = "daily listeners";

  /* Where the number came from, kept with the number. */
  const source = val(r, "source");
  const notes = val(r, "notes");
  const prov = [source && `source: ${source}`, notes].filter(Boolean).join(" — ");
  if (prov) set("notes", prov);

  /* A citation is what turns an estimate into a sourced figure. Without one
     the numbers are still written, and still say "estimate — not sourced" on
     screen, which is the honest state for almost everything in the catalogue. */
  if (source) {
    set("sourceNote", source);
    if (data.audience) data.audienceProvenance = "SOURCED";
    if (data.rateEstimatePkr) data.rateProvenance = "SOURCED";
  }

  /* The generated profile is corrected in place, so the profile page and the
     card stop showing invented figures beside real ones. */
  const profile = contact.profile ? { ...contact.profile } : null;
  if (profile) {
    if (data.audience) profile.dailyListeners = data.audience;
    if (data.rateEstimatePkr) { profile.priceMin = data.rateEstimatePkr; profile.priceMax = Math.round(data.rateEstimatePkr * 2.5); }
    if (data.name) profile.name = data.name;
    if (data.city) profile.city = data.city;
    if (data.frequency) profile.frequency = data.frequency;
    if (data.category) profile.genre = data.category;
    const langs = val(r, "languages");
    if (langs) profile.language = langs.split(/[;/|]/).map((s) => s.trim()).filter(Boolean);
    const peak = val(r, "peak_times");
    if (peak) profile.peakTimes = peak.split(/[;/|]/).map((s) => s.trim()).filter(Boolean);
    const bestFor = val(r, "best_for");
    if (bestFor) profile.bestFor = bestFor.split(/[;/|]/).map((s) => s.trim()).filter(Boolean);
    if (Object.keys(data).length) data.profile = profile;
  }

  const filled = Object.keys(data).filter((k) => k !== "profile" && k !== "audienceBasis");
  if (!filled.length) { console.log(`  -  ${id} — no values filled in, left alone`); continue; }

  console.log(`  ${apply ? "->" : "  "} ${id.padEnd(20)} ${filled.join(", ")}`);
  if (apply) await prisma.contact.update({ where: { externalId: id }, data });
  changed++;
}

console.log(`\n${apply ? "updated" : "would update"} ${changed} station(s)${skipped ? `, ${skipped} unknown id(s) skipped` : ""}`);
if (!apply) console.log("Nothing changed. Re-run with --apply.");
await prisma.$disconnect();
