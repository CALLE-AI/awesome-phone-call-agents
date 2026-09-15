import { notFound } from "next/navigation";

import ShellHarness from "../../shell/ShellHarness";
import StationProfile from "@/app/radio/[stationId]/_components/StationProfile";
import { getStation } from "@/app/radio/_data";

const TABS = ["overview", "audience", "schedule", "schedule"] as const;

/* Mirrors /radio/<stationId> so the breadcrumb derives the same trail. */
export default async function DevStationPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!TABS.includes(tab as typeof TABS[number])) notFound();

  const station = getStation("city-fm-89-khi");
  if (!station) notFound();

  return (
    <ShellHarness crumb={station.name}>
      <StationProfile
        station={station}
        campaigns={[{ id: "c1", name: "Shan Masala Ramzan Push" }]}
        initialTab={tab as typeof TABS[number]}
      />
    </ShellHarness>
  );
}
