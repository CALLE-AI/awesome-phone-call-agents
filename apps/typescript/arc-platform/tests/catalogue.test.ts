import { describe, it, expect } from "vitest";
import {
  joinCatalogue,
  sampleRecommendations,
  stationMenu,
  creatorMenu,
  type Catalogue,
} from "@/lib/catalogue";

/**
 * The generator used to be handed example stations with invented listener
 * counts and it kept inventing: plans came back naming fm_107_isl and
 * power99_lhr, neither of which Arc carries. These guard the two halves of the
 * fix - the model may only choose ids we hold, and every fact beside the id
 * comes from our records.
 *
 * The catalogue is a fixture rather than the database, because these are rules
 * about shape and refusal, not about what happens to be seeded today.
 */
const cat: Catalogue = {
  stations: [
    {
      stationId: "fm-100-mul", stationName: "FM 100", city: "Multan",
      frequency: "100.0 MHz", audienceProfile: "Pirzada Family",
      estimatedDailyListeners: null, estimatedCostPKR: null,
    },
    {
      stationId: "city-fm-89-khi", stationName: "CityFM89", city: "Karachi",
      frequency: "89.0 MHz", audienceProfile: "Dawn Media Group",
      estimatedDailyListeners: 2_100_000, estimatedCostPKR: 12_000,
    },
  ],
  creators: [
    {
      id: "sanalifestyle_pk", username: "sanalifestyle_pk", displayName: "Sana Malik",
      platform: "instagram", niche: "Lifestyle", city: "Karachi",
      estimatedFollowers: 48_000, audienceBasis: "followers", estimatedCostPKR: 18_000,
    },
    {
      id: "waleedcricketgalli", username: "waleedcricketgalli", displayName: "Waleed Ahmad",
      platform: "tiktok", niche: "Cricket", city: "Rawalpindi",
      estimatedFollowers: 1_580_000, audienceBasis: "followers", estimatedCostPKR: null,
    },
  ],
};

const goodStation = () => ({
  stationId: "city-fm-89-khi",
  recommendedSlots: ["Morning Drive 7-9am"],
  audienceMatchScore: 88,
  rationale: "Fits the brief",
});
const goodCreator = () => ({ id: "sanalifestyle_pk", matchScore: 92, matchRationale: "Fits" });

describe("a generated plan may only contain inventory we can sell", () => {
  it("accepts a plan whose ids are all in the catalogue", () => {
    const r = joinCatalogue(
      { stationRecommendations: [goodStation()], influencerMatches: [goodCreator()] },
      cat
    );
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("rejects the whole plan when one station does not exist", () => {
    const r = joinCatalogue(
      {
        stationRecommendations: [goodStation(), { ...goodStation(), stationId: "power99_lhr" }],
        influencerMatches: [goodCreator()],
      },
      cat
    );
    // Not "keep the two that were fine": a plan quietly missing a line reads
    // as a complete plan and is not one.
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("power99_lhr");
  });

  it("rejects a creator that does not exist", () => {
    const r = joinCatalogue({ influencerMatches: [{ ...goodCreator(), id: "urbanmom_karachi" }] }, cat);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("urbanmom_karachi");
  });

  it("rejects a missing id rather than treating it as an empty one", () => {
    const r = joinCatalogue({ stationRecommendations: [{ rationale: "no id" }] }, cat);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("(missing)");
  });

  it("rejects a plan that recommends nothing at all", () => {
    const r = joinCatalogue({ stationRecommendations: [], influencerMatches: [] }, cat);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("no stations and no creators");
  });
});

describe("facts come from the record, never from the model", () => {
  it("overwrites audience figures and rates the model sent anyway", () => {
    const r = joinCatalogue(
      {
        stationRecommendations: [
          {
            ...goodStation(),
            stationId: "fm-100-mul",
            // Exactly the invention this path exists to stop.
            stationName: "Power 99 FM",
            estimatedDailyListeners: 9_999_999,
            estimatedCostPKR: 45_000,
            city: "Atlantis",
          },
        ],
      },
      cat
    );
    const joined = (r.data.stationRecommendations as Record<string, unknown>[])[0];
    expect(joined.stationName).toBe("FM 100");
    expect(joined.city).toBe("Multan");
    // The record says null, so the plan says null - a rate we do not have must
    // not arrive as a number the model made up.
    expect(joined.estimatedCostPKR).toBeNull();
    expect(joined.estimatedDailyListeners).toBeNull();
  });

  it("keeps the judgement fields, which are the model's to give", () => {
    const r = joinCatalogue({ stationRecommendations: [goodStation()] }, cat);
    const joined = (r.data.stationRecommendations as Record<string, unknown>[])[0];
    expect(joined.audienceMatchScore).toBe(88);
    expect(joined.rationale).toBe("Fits the brief");
    expect(joined.recommendedSlots).toEqual(["Morning Drive 7-9am"]);
  });

  it("resolves a creator by handle as well as by id", () => {
    const r = joinCatalogue({ influencerMatches: [{ ...goodCreator(), id: "waleedcricketgalli" }] }, cat);
    expect(r.ok).toBe(true);
  });
});

describe("the menu tells the model what it needs to choose well", () => {
  it("names the city on every line, because that is what the brief is matched on", () => {
    expect(stationMenu(cat)).toContain("Multan");
    expect(stationMenu(cat)).toContain("Karachi");
    expect(creatorMenu(cat)).toContain("Rawalpindi");
  });

  it("states a missing rate rather than omitting the field", () => {
    // An absent field invites the model to fill it in. A stated absence does not.
    expect(stationMenu(cat)).toContain("rate not on file");
    expect(creatorMenu(cat)).toContain("rate not on file");
  });
});

describe("the offline sample plan is held to the same standard", () => {
  it("passes the validator that a real generation has to pass", () => {
    const s = sampleRecommendations(cat);
    const r = joinCatalogue(
      { stationRecommendations: s.stations, influencerMatches: s.creators },
      cat
    );
    expect(r.ok).toBe(true);
  });

  it("prefers the brief's own city", () => {
    // The demo path should show a Multan brief Multan stations for the same
    // reason the real one should.
    const s = sampleRecommendations(cat, ["Multan"]);
    expect(s.stations.map((x) => x.stationId)).toEqual(["fm-100-mul"]);
  });

  it("falls back to the whole list rather than returning nothing", () => {
    // Thin coverage in a city should look like thin coverage, not a broken
    // generator handing back an empty plan.
    const s = sampleRecommendations(cat, ["Quetta"]);
    expect(s.stations.length).toBeGreaterThan(0);
  });
});
