import ShellHarness from "../shell/ShellHarness";
import { db } from "@/lib/db";
import { getStation } from "@/app/radio/_data";
import StationDirectory, { type DirectoryStation } from "@/app/radio/_components/StationDirectory";

/* Reads the database now, so it cannot be prerendered at build time - Next
   tried, Prisma had no connection during export, and the whole build failed.
   The dev harnesses are rendered on demand like every other page that needs
   data. */
export const dynamic = "force-dynamic";

export default async function DevRadioListPage() {
  const contacts = await db.contact.findMany({
    where: { type: "STATION" },
    orderBy: [{ name: "asc" }, { city: "asc" }],
    select: {
      externalId: true, name: true, formerName: true, city: true, frequency: true,
      category: true, owner: true, audience: true, audienceBasis: true,
      rateEstimatePkr: true, phone: true,
      rateProvenance: true, audienceProvenance: true, sourceNote: true,
    },
  });
  const items: DirectoryStation[] = contacts.map((c) => ({
    ...c,
    rateProvenance: c.rateProvenance,
    audienceProvenance: c.audienceProvenance,
    sourceNote: c.sourceNote,
    hasPhone: Boolean(c.phone),
    detail: getStation(c.externalId) ?? null,
  }));

  return (
    <ShellHarness>
      <StationDirectory campaigns={[]} items={items} />
    </ShellHarness>
  );
}
