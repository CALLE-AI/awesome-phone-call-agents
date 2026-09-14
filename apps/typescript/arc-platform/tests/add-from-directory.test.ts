import { describe, it, expect } from "vitest";
import { reducer } from "@/app/campaigns/create/_components/WizardContext";
import type { WizardState, StationRec, InfluencerMatch } from "@/app/campaigns/create/_components/WizardContext";

/**
 * The Select step used to show only what the model returned. When it returned
 * no stations for a brief that asked for radio, the tab rendered an empty div
 * and Continue stayed disabled - because it requires a ticked station. Blank
 * screen, no reason given, no way forward.
 *
 * Arc proposes and the buyer decides, so the directory is reachable whether or
 * not the model matched anything.
 */
const station = (id: string): StationRec => ({
  stationId: id, stationName: id, city: "Karachi", frequency: "89.0",
  audienceProfile: null, estimatedDailyListeners: null, recommendedSlots: [],
  estimatedCostPKR: null, audienceMatchScore: null, rationale: null,
});

const creator = (id: string): InfluencerMatch => ({
  id, username: id, displayName: id, platform: "instagram", niche: null,
  city: "Karachi", estimatedFollowers: null, audienceBasis: null,
  estimatedCostPKR: null, matchScore: null, matchRationale: null,
});

const base = (): WizardState => ({
  step: "select",
  brief: { channels: ["radio", "influencer"] },
  generated: {
    scripts: [], stationRecommendations: [], influencerMatches: [],
    budgetAllocation: { radio: 55, influencer: 35, platformFee: 10 },
    estimatedTotalReach: 0, campaignInsights: "", bestLaunchTiming: "",
    riskFactors: "", generationTimeMs: 0,
  },
  selections: { selectedScriptIds: [], selectedStationIds: [], selectedInfluencerIds: [] },
} as unknown as WizardState);

describe("adding a line the model did not pick", () => {
  it("adds the station AND ticks it, so the buyer need not find it again", () => {
    const s = reducer(base(), { type: "ADD_STATION", station: station("fm-100-khi") });
    expect(s.generated!.stationRecommendations).toHaveLength(1);
    expect(s.selections.selectedStationIds).toEqual(["fm-100-khi"]);
  });

  it("does the same for a creator", () => {
    const s = reducer(base(), { type: "ADD_INFLUENCER", influencer: creator("sana") });
    expect(s.generated!.influencerMatches).toHaveLength(1);
    expect(s.selections.selectedInfluencerIds).toEqual(["sana"]);
  });

  /* Two of the same row is a duplicate React key, which is how the "Din Ka
     Aghaz" crash started. */
  it("adding the same station twice changes nothing the second time", () => {
    let s = reducer(base(), { type: "ADD_STATION", station: station("fm-100-khi") });
    s = reducer(s, { type: "ADD_STATION", station: station("fm-100-khi") });
    expect(s.generated!.stationRecommendations).toHaveLength(1);
    expect(s.selections.selectedStationIds).toEqual(["fm-100-khi"]);
  });

  it("adding the same creator twice changes nothing the second time", () => {
    let s = reducer(base(), { type: "ADD_INFLUENCER", influencer: creator("sana") });
    s = reducer(s, { type: "ADD_INFLUENCER", influencer: creator("sana") });
    expect(s.generated!.influencerMatches).toHaveLength(1);
  });

  it("keeps what the model already returned, newest first", () => {
    const start = base();
    start.generated!.stationRecommendations = [{ ...station("ai-picked"), audienceMatchScore: 88 }];
    const s = reducer(start, { type: "ADD_STATION", station: station("hand-picked") });
    expect(s.generated!.stationRecommendations.map(r => r.stationId)).toEqual(["hand-picked", "ai-picked"]);
  });

  /* A hand-picked line was scored by nobody. Zero would render as a score and
     read as "Arc rated your own choice 0 out of 100". */
  it("carries no match score, and never a zero", () => {
    const s = reducer(base(), { type: "ADD_STATION", station: station("fm-100-khi") });
    expect(s.generated!.stationRecommendations[0].audienceMatchScore).toBeNull();
    expect(s.generated!.stationRecommendations[0].rationale).toBeNull();
  });

  it("does nothing when there is no plan to add to", () => {
    const empty = { ...base(), generated: null } as WizardState;
    expect(reducer(empty, { type: "ADD_STATION", station: station("x") })).toBe(empty);
  });
});
