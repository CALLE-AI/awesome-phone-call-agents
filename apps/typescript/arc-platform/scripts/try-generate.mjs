/**
 * Run a real generation against real briefs. Costs money; places no calls.
 *
 *   node scripts/try-generate.mjs                    # Multan, Peshawar, Karachi
 *   node scripts/try-generate.mjs Multan             # one city
 *
 * This drives lib/plan-generate.ts - the same code the wizard's route runs -
 * rather than a copy of the prompts, which is the only way a check like this
 * says anything about the route. Nothing is written to the database.
 *
 * It is .mjs because jiti's CLI does not resolve the "@/" alias that the lib
 * files import each other with; the programmatic API does, given the alias.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* Scripts are run straight from a shell, so nothing has loaded .env.local. */
for (const file of [".env.local", ".env"]) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { loadCatalogue } = await jiti.import(path.join(root, "lib/catalogue.ts"));
const { generatePlan } = await jiti.import(path.join(root, "lib/plan-generate.ts"));
const { prisma } = await jiti.import(path.join(root, "lib/db.ts"));

const BRIEFS = {
  Multan: {
    productName: "Coastal Cafe", productDescription: "A new speciality coffee house on Bosan Road with an all-day breakfast menu",
    campaignGoal: "awareness", targetAudience: "Students and young professionals 18-32 who eat out on weekends",
    targetCities: ["Multan"], totalBudget: 180000, budgetCurrency: "PKR", duration: 30,
    channels: ["radio", "influencer"], tone: "playful", specialOffer: "Free dessert on the first 200 orders", competitors: "",
  },
  Peshawar: {
    productName: "Khyber Dairy Fresh Milk", productDescription: "Pasteurised full-cream milk in 1L packs, delivered daily",
    campaignGoal: "sales", targetAudience: "Household grocery buyers, mothers 28-50",
    targetCities: ["Peshawar"], totalBudget: 350000, budgetCurrency: "PKR", duration: 30,
    channels: ["radio", "influencer"], tone: "warm", specialOffer: "", competitors: "Olpers, Nurpur",
  },
  Karachi: {
    productName: "Zeb Modest Wear", productDescription: "Ready-to-wear modest clothing line for working women, launching Eid collection",
    campaignGoal: "launch", targetAudience: "Working women 25-40 in urban Karachi",
    targetCities: ["Karachi"], totalBudget: 500000, budgetCurrency: "PKR", duration: 14,
    channels: ["radio", "influencer"], tone: "professional", specialOffer: "20% launch discount", competitors: "Khaadi, Sapphire",
  },
};

const wanted = process.argv.slice(2).filter((a) => BRIEFS[a]);
const cities = wanted.length ? wanted : Object.keys(BRIEFS);

const cat = await loadCatalogue();
console.log(`catalogue: ${cat.stations.length} stations, ${cat.creators.length} creators\n`);

for (const city of cities) {
  const brief = BRIEFS[city];
  const r = await generatePlan(brief, cat);
  console.log(`══ ${city} — ${brief.productName} ══`);
  console.log(`   source=${r.source}  ${(r.generationTimeMs / 1000).toFixed(1)}s${r.sampleReason ? `  (${r.sampleReason})` : ""}`);

  if (!r.plan) {
    console.log(`   FAILED (${r.failed}): ${(r.problems ?? []).join("; ")}\n`);
    continue;
  }

  const st = r.plan.stationRecommendations ?? [];
  const cr = r.plan.influencerMatches ?? [];
  const inCity = (rows) => rows.filter((x) => x.city === city).length;
  console.log(`   stations: ${st.length} (${inCity(st)} in ${city})`);
  for (const s of st) console.log(`      ${s.stationId.padEnd(22)} ${String(s.stationName).padEnd(24)} ${s.city ?? "?"}  ${s.estimatedCostPKR == null ? "rate not on file" : `PKR ${s.estimatedCostPKR}`}`);
  console.log(`   creators: ${cr.length} (${inCity(cr)} in ${city})`);
  for (const c of cr) console.log(`      ${c.id.padEnd(22)} ${String(c.displayName).padEnd(24)} ${c.city ?? "?"}`);

  const s1 = (r.plan.scripts ?? [])[0] ?? {};
  console.log(`   script 1 hook: ${s1.hook ?? "—"}`);
  console.log(`   script 1 body: ${s1.body ?? "—"}`);
  console.log(`   reach: ${Number(r.plan.estimatedTotalReach).toLocaleString()}\n`);
}

await prisma.$disconnect();
