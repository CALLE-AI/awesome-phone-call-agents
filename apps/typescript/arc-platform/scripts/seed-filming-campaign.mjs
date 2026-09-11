/**
 * The campaign the film is shot on.
 *
 *   node scripts/seed-filming-campaign.mjs newest        # report
 *   node scripts/seed-filming-campaign.mjs newest --apply
 *   node scripts/seed-filming-campaign.mjs <brandId> --apply
 *
 * Builds one campaign with one plan line for City FM 89 Karachi, carrying the
 * catalogue's rate estimate. The estimate is what makes a mandate exist - with
 * none, buildMandate returns null and the agent never negotiates - so the line
 * is refused rather than created if the contact has no estimate on file.
 *
 * The name and brief are real ones a media buyer would recognise. They are on
 * camera; "test" is not a campaign name.
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
const { maskPhone } = await jiti.import(path.join(root, "lib/mask.ts"));

const which = process.argv[2] ?? "newest";
const apply = process.argv.includes("--apply");
const STATION = "city-fm-89-khi";

const CAMPAIGN = {
  name: "Zeb Modest Wear — Eid 2026",
  status: "ACTIVE",
  budgetTotal: 500000,
  currency: "PKR",
  durationDays: 21,
};

const brand = which === "newest"
  ? await prisma.brand.findFirst({ orderBy: { createdAt: "desc" } })
  : await prisma.brand.findUnique({ where: { id: which } });
if (!brand) { console.error(`No brand for "${which}".`); process.exit(1); }

const contact = await prisma.contact.findUnique({ where: { externalId: STATION } });
if (!contact) { console.error(`${STATION} is not in the catalogue.`); process.exit(1); }
if (!contact.rateEstimatePkr) {
  console.error(`${STATION} has no rate estimate, so no mandate would be built. Refusing.`);
  process.exit(2);
}
if (!contact.phone) { console.error(`${STATION} has no number on file. Refusing.`); process.exit(2); }

console.log(`brand:    ${brand.name}  ${brand.id}`);
console.log(`          clerkOrgId ${brand.clerkOrgId}  created ${brand.createdAt.toISOString().slice(0, 10)}`);
console.log(`campaign: "${CAMPAIGN.name}"  ${CAMPAIGN.currency} ${CAMPAIGN.budgetTotal.toLocaleString()}  ${CAMPAIGN.durationDays} days`);
console.log(`line:     ${contact.name} (${contact.city})  estimate PKR ${contact.rateEstimatePkr.toLocaleString()}  ${maskPhone(contact.phone)}`);
console.log(`          -> mandate will be target ~PKR ${(Math.round(contact.rateEstimatePkr * 0.85 / 500) * 500).toLocaleString()}, walk-away ~PKR ${(Math.round(contact.rateEstimatePkr * 1.15 / 500) * 500).toLocaleString()}`);

if (!apply) { console.log("\nNothing created. Re-run with --apply."); await prisma.$disconnect(); process.exit(0); }

const existing = await prisma.campaign.findFirst({ where: { brandId: brand.id, name: CAMPAIGN.name } });
const campaign = existing ?? await prisma.campaign.create({
  data: { ...CAMPAIGN, brandId: brand.id },
});

const item = await prisma.mediaPlanItem.findFirst({ where: { campaignId: campaign.id, externalId: STATION } })
  ?? await prisma.mediaPlanItem.create({
    data: {
      campaignId: campaign.id,
      kind: "STATION",
      externalId: contact.externalId,
      name: contact.name,
      channel: contact.channel,
      city: contact.city,
      estCostPkr: contact.rateEstimatePkr,
      estReach: contact.audience,
      rationale: "Karachi's strongest ABC1 urban station for a working-women audience.",
      recommendedSlots: ["Morning Drive 7-9am", "Evening Drive 5-7pm"],
      status: "SELECTED",
    },
  });

console.log(`\ncampaign id:  ${campaign.id}`);
console.log(`plan line id: ${item.id}`);
console.log(`\nCall it with:\n  ./scripts/call-and-archive.sh ${item.id}`);
await prisma.$disconnect();
