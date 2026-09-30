import ShellHarness from "../shell/ShellHarness";
import { db } from "@/lib/db";
import { getCreator, type Creator } from "@/app/influencers/_data";
import InfluencerMarket, { type DirectoryCreator } from "@/app/influencers/_components/InfluencerMarket";

/* Reads the Contact table like the real page, so the harness previews the real
   mix of rich and short cards rather than a fixture of the eight we wrote up. */
export const dynamic = "force-dynamic";

export default async function DevInfluencerListPage() {
  const contacts = await db.contact.findMany({
    where: { type: "CREATOR" },
    orderBy: [{ name: "asc" }],
    select: {
      externalId: true, name: true, handle: true, channel: true, city: true,
      category: true, audience: true, audienceBasis: true, rateEstimatePkr: true, phone: true, profile: true,
    },
  });

  const items: DirectoryCreator[] = contacts.map((c) => {
    const handle = (c.handle ?? c.externalId).replace(/^@/, "");
    return {
      externalId: c.externalId, name: c.name, handle, channel: c.channel, city: c.city,
      category: c.category, audience: c.audience, audienceBasis: c.audienceBasis,
      rateEstimatePkr: c.rateEstimatePkr, hasPhone: Boolean(c.phone),
      detail: getCreator(handle) ?? ((c.profile as Creator | null) ?? null),
    };
  });

  return (
    <ShellHarness>
      <InfluencerMarket items={items} campaigns={[]} />
    </ShellHarness>
  );
}
