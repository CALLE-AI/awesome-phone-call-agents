import { notFound } from "next/navigation";

import ShellHarness from "../../shell/ShellHarness";
import CreatorProfile from "@/app/influencers/[username]/_components/CreatorProfile";
import { getCreator } from "@/app/influencers/_data";

const TABS = ["about", "audience", "about", "book"] as const;
type Tab = typeof TABS[number];

/* Mirrors /influencers/<username> so the breadcrumb derives the same trail,
   with the tab in the path so each one can be reviewed on its own. */
export default async function DevCreatorPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!TABS.includes(tab as Tab)) notFound();

  const creator = getCreator("sanalifestyle_pk");
  if (!creator) notFound();

  return (
    <ShellHarness crumb={creator.displayName}>
      <CreatorProfile
        creator={creator}
        campaigns={[{ id: "c1", name: "Shan Masala Ramzan Push" }]}
        initialTab={tab as Tab}
      />
    </ShellHarness>
  );
}
