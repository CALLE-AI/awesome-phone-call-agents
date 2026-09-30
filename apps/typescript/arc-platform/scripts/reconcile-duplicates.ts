/**
 * One station, one row.
 *
 *   node_modules/.bin/jiti scripts/reconcile-duplicates.ts          # report only
 *   node_modules/.bin/jiti scripts/reconcile-duplicates.ts --apply  # merge
 *
 * The Contact table was filled from two sources: the eight stations hardcoded
 * in app/radio/_data.ts, and a 35-row CSV of the real Pakistani FM catalogue.
 * Where they describe the same transmitter under different ids, a generated
 * plan can list it twice - once priced from _data.ts and once with no rate -
 * which reads as two stations you could buy separately.
 *
 * A frequency in a city is one station, so that is the test. The pairs below
 * are stated explicitly rather than merged by rule: deleting a row because two
 * numbers matched is how a real station quietly disappears from the catalogue.
 * Anything the detector finds that is NOT listed here is reported and left
 * alone for a human to judge.
 *
 * The surviving id is the CSV one - the real catalogue, city by city. The
 * legacy row's rate and audience are carried across first, because an estimate
 * from _data.ts is real reference data and the contrast between an estimate
 * and a rate heard on a call is the product's whole argument.
 */
import { prisma } from "../lib/db";

/**
 * keep, absorb, and why we are confident they are the same transmitter.
 *
 * `formerName` is set only where the retired row holds a name people still
 * use. It is not a place to park the loser's label: a legacy id that simply
 * spelled the same station differently leaves nothing behind.
 */
const MERGES: { keep: string; absorb: string; because: string; formerName?: string }[] = [
  {
    keep: "fm-101-khi",
    absorb: "fm-101-national",
    because: "both FM 101 on 101.0 MHz in Karachi; the legacy id modelled a national brand as one row",
  },
  {
    keep: "city-fm-89-lhr",
    absorb: "fm-89-lhr",
    because: "both 89.0 MHz in Lahore; CityFM89 Lahore, recorded under two names",
  },
  {
    keep: "mera-fm-1074-khi",
    absorb: "samaa-fm",
    because:
      "one station: 107.4 MHz Karachi launched as Samaa FM in 2012 and rebranded " +
      "to MERA FM 107.4 in November 2021",
    /* Half the market still says Samaa, so the old name has to keep finding
       the new row. */
    formerName: "Samaa FM",
  },
];

const norm = (f: string | null) => (f ?? "").replace(/[^0-9.]/g, "");

async function main() {
  const apply = process.argv.includes("--apply");

  const stations = await prisma.contact.findMany({
    where: { type: "STATION" },
    select: { externalId: true, name: true, city: true, frequency: true, rateEstimatePkr: true, audience: true, audienceBasis: true },
  });

  /* Report every collision, so a merge that is not listed cannot pass
     unnoticed as "already handled". */
  const groups = new Map<string, typeof stations>();
  for (const s of stations) {
    const f = norm(s.frequency);
    if (!f || !s.city) continue;
    const k = `${f} MHz · ${s.city}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  const planned = new Set(MERGES.flatMap((m) => [m.keep, m.absorb]));
  const unhandled: string[] = [];
  for (const [k, g] of groups) {
    if (g.length < 2) continue;
    const ids = g.map((x) => x.externalId);
    if (ids.every((id) => planned.has(id))) continue;
    unhandled.push(`${k}: ${g.map((x) => `${x.externalId} (${x.name})`).join("  vs  ")}`);
  }

  for (const m of MERGES) {
    const keep = stations.find((s) => s.externalId === m.keep);
    const absorb = stations.find((s) => s.externalId === m.absorb);
    if (!keep || !absorb) {
      console.log(`skip ${m.absorb} -> ${m.keep}: one of them is already gone`);
      continue;
    }
    /* Only fill gaps. A value already on the surviving row is not overwritten
       by the one being retired. */
    const data = {
      rateEstimatePkr: keep.rateEstimatePkr ?? absorb.rateEstimatePkr,
      audience: keep.audience ?? absorb.audience,
      audienceBasis: keep.audienceBasis ?? absorb.audienceBasis,
      ...(m.formerName ? { formerName: m.formerName } : {}),
    };
    console.log(
      `${apply ? "merging" : "would merge"}: ${absorb.externalId} (${absorb.name}) -> ${keep.externalId} (${keep.name})\n` +
      `   ${m.because}\n` +
      `   carries across: rate=${data.rateEstimatePkr ?? "none"} audience=${data.audience ?? "none"}` +
      (m.formerName ? `, also known as "${m.formerName}"` : "")
    );
    if (apply) {
      await prisma.contact.update({ where: { externalId: keep.externalId }, data });
      await prisma.contact.delete({ where: { externalId: absorb.externalId } });
    }
  }

  if (unhandled.length) {
    console.log(
      `\nNOT merged - same frequency and city, but not a pair anyone has ruled on:\n  ` +
      unhandled.join("\n  ") +
      `\n  Two brands cannot share one frequency in one city, so one of these records is\n` +
      `  wrong. Decide which, then add it to MERGES - do not let a script guess.`
    );
  }

  if (!apply) console.log("\nNothing was changed. Re-run with --apply.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
