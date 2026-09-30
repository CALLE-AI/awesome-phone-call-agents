import { notFound } from "next/navigation";

import ShellHarness from "../../shell/ShellHarness";
import CampaignDetail, { type CampaignSummary } from "@/app/campaigns/[id]/_components/CampaignDetail";
import AutoOpen from "./AutoOpen";

/* Both states of /campaigns/<id>: one launched since the plan is stored, and
   one created before the migration, which has no plan and never will. */
const BASE = {
  id: "cmf2k9x7a0001qw3v8n4d5e6f",
  name: "Shan Masala Ramzan Push",
  status: "ACTIVE",
  createdAt: new Date("2026-08-18T09:00:00Z"),
  currency: "PKR",
};

const LEGACY: CampaignSummary = {
  ...BASE, budgetTotal: null, durationDays: null, flightStart: null, flightEnd: null,
  estStationCost: null, estInfluencerCost: null, estPlatformFee: null,
  estTotalCost: null, estTotalReach: null, items: [], scripts: [],
};

const WITH_PLAN: CampaignSummary = {
  ...BASE,
  budgetTotal: 450000,
  durationDays: 30,
  flightStart: new Date("2026-09-01"),
  flightEnd: new Date("2026-09-30"),
  estStationCost: 260000,
  estInfluencerCost: 148000,
  estPlatformFee: 40800,
  estTotalCost: 448800,
  estTotalReach: 4260000,
  items: [
    { id: "i1", kind: "STATION", name: "City FM 89", channel: "radio", city: "Karachi",
      estCostPkr: 132000, estReach: 2100000, matchScore: 94, rationale: "Strongest FMCG audience in Karachi",
      recommendedSlots: ["7–9am", "5–7pm"], confirmedRatePkr: 148000, confirmedReach: null,
      availability: "YES", confirmedNotes: "Wants a signed IO before holding inventory.",
      calls: [{ mock: false, outcome: "RESULT" }], spots: 12, bookedTotalPkr: 148000, bookedAt: new Date("2026-08-19T10:00:00Z"), status: "BOOKED" },
    { id: "i2", kind: "STATION", name: "Mast FM 103", channel: "radio", city: "Lahore",
      estCostPkr: 128000, estReach: 890000, matchScore: 81, rationale: "Lahore reach at a lower CPM",
      recommendedSlots: ["7–9am"], confirmedRatePkr: null, confirmedReach: null,
      availability: null, confirmedNotes: null,
      calls: [], spots: null, bookedTotalPkr: null, bookedAt: null, status: "CALLING" },
    { id: "i3", kind: "CREATOR", name: "Sana Malik", channel: "instagram", city: "Karachi",
      estCostPkr: 78000, estReach: 144000, matchScore: 94, rationale: "7%+ engagement, FMCG-heavy audience",
      recommendedSlots: [], confirmedRatePkr: 82000, confirmedReach: null,
      availability: "YES", confirmedNotes: "Open to a package deal for the full flight.",
      calls: [{ mock: true, outcome: "RESULT" }], spots: 1, bookedTotalPkr: 82000, bookedAt: new Date("2026-08-19T10:05:00Z"), status: "BOOKED" },
    { id: "i4", kind: "CREATOR", name: "Nadia Khan", channel: "tiktok", city: "Lahore",
      estCostPkr: 70000, estReach: 62000, matchScore: 76, rationale: "Food niche overlap",
      recommendedSlots: [], confirmedRatePkr: null, confirmedReach: null,
      availability: "UNKNOWN", confirmedNotes: null,
      calls: [], spots: null, bookedTotalPkr: null, bookedAt: null, status: "SELECTED" },
  ],
  scripts: [
    { id: "s1", language: "urdu", durationSec: 30, title: "Ramzan Morning Drive",
      hook: "Is Ramzan, har dastarkhwan ki shaan.",
      body: "Shan Masala ke saath banaiye woh zaiqa jo aap ke ghar walon ko yaad rahe. Har packet mein wahi asli khushbu, wahi asli zaiqa.",
      callToAction: "Shan Masala — ab har kirane ki dukaan par.",
      bestTimeSlots: ["7–9am", "5–7pm"] },
  ],
};

export default async function DevCampaignPage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  if (!["plan", "legacy", "calling"].includes(state)) notFound();
  const campaign = state === "legacy" ? LEGACY : WITH_PLAN;
  return (
    <ShellHarness crumb={campaign.name}>
      {state === "calling" && <AutoOpen />}
      <CampaignDetail campaign={campaign} />
    </ShellHarness>
  );
}
