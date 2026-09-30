import { describe, it, expect } from "vitest";
import { shortlist, type Catalogue } from "@/lib/catalogue";
import { buildSelectionTool, selectionToPlan, SELECTION_TOOL } from "@/lib/plan-tool";

/**
 * The model invented station ids twice in a row and threw away an 82-second
 * generation both times. Telling it not to did not work, so the ids it may
 * return are now an enum in the tool schema. These guard the two halves of
 * that: the enum is built from the shortlist, and the shortlist is the right
 * dozen rows rather than the whole country.
 */
const cat: Catalogue = {
  stations: [
    { stationId: "fm-100-mul", stationName: "FM 100 Multan", city: "Multan", frequency: "100.0 MHz", audienceProfile: null, estimatedDailyListeners: null, estimatedCostPKR: null },
    { stationId: "fm-101-mul", stationName: "FM 101 Multan", city: "Multan", frequency: "101.0 MHz", audienceProfile: null, estimatedDailyListeners: null, estimatedCostPKR: null },
    { stationId: "city-fm-89-khi", stationName: "CityFM89", city: "Karachi", frequency: "89.0 MHz", audienceProfile: null, estimatedDailyListeners: 2_100_000, estimatedCostPKR: 12_000 },
    { stationId: "hot-fm-105-lhr", stationName: "Hot FM 105", city: "Lahore", frequency: "105.0 MHz", audienceProfile: null, estimatedDailyListeners: null, estimatedCostPKR: null },
  ],
  creators: [
    { id: "sanalifestyle_pk", username: "sanalifestyle_pk", displayName: "Sana Malik", platform: "instagram", niche: "Lifestyle", city: "Karachi", estimatedFollowers: 48_000, audienceBasis: "followers", estimatedCostPKR: 18_000 },
    { id: "multanfoodie", username: "multanfoodie", displayName: "Multan Foodie", platform: "tiktok", niche: "Food", city: "Multan", estimatedFollowers: null, audienceBasis: "followers", estimatedCostPKR: null },
  ],
};

describe("the menu is narrowed to what this brief could buy", () => {
  it("puts the brief's own city first", () => {
    const s = shortlist(cat, { cities: ["Multan"] });
    expect(s.stations.slice(0, 2).map((x) => x.stationId)).toEqual(["fm-100-mul", "fm-101-mul"]);
  });

  it("tops the list up rather than leaving it short", () => {
    // Thin coverage in a city is a real situation. It should produce a plan
    // with a line from elsewhere and a rationale, not three fewer stations.
    const s = shortlist(cat, { cities: ["Quetta"] });
    expect(s.stations.length).toBe(4);
  });

  it("caps the menu, because 71 rows is a worse question than a dozen", () => {
    const s = shortlist(cat, { cities: ["Multan"], max: 2 });
    expect(s.stations.map((x) => x.stationId)).toEqual(["fm-100-mul", "fm-101-mul"]);
  });

  it("drops stations when the brief did not ask for radio", () => {
    const s = shortlist(cat, { channels: ["influencer"] });
    expect(s.stations).toEqual([]);
    expect(s.creators.length).toBeGreaterThan(0);
  });

  it("shows everything rather than an empty menu when the channels name neither", () => {
    // "digital" alone would otherwise produce a plan with nothing in it.
    const s = shortlist(cat, { channels: ["digital"] });
    expect(s.stations.length).toBeGreaterThan(0);
    expect(s.creators.length).toBeGreaterThan(0);
  });
});

/* The schema the API validates the model's arguments against. */
type Schema = {
  properties: Record<string, { items?: { properties: Record<string, { enum?: string[] }> } }>;
  required: string[];
  additionalProperties: boolean;
};
const schemaOf = (c: Catalogue) => buildSelectionTool(c).input_schema as unknown as Schema;

describe("an id outside the catalogue is not a thing the reply can contain", () => {
  it("lists every allowed station id, and only those, as an enum", () => {
    const ids = schemaOf(cat).properties.stations?.items?.properties.stationId.enum;
    expect(ids).toEqual(["fm-100-mul", "fm-101-mul", "city-fm-89-khi", "hot-fm-105-lhr"]);
    expect(ids).not.toContain("power99_lhr");
  });

  it("is strict, so the API enforces the enum instead of the prompt asking for it", () => {
    const tool = buildSelectionTool(cat);
    expect(tool.strict).toBe(true);
    expect(schemaOf(cat).additionalProperties).toBe(false);
    expect(tool.name).toBe(SELECTION_TOOL);
  });

  it("omits a field it has no ids for rather than offering an empty enum", () => {
    // An empty enum is not a schema the API accepts, and a radio-only brief
    // should not be shown a creators field at all.
    const radioOnly = shortlist(cat, { channels: ["radio"] });
    const s = schemaOf(radioOnly);
    expect(s.properties.creators).toBeUndefined();
    expect(s.required).not.toContain("creators");
    expect(s.required).toContain("stations");
  });
});

describe("the tool's arguments become the plan's shape", () => {
  it("reads stations and creators across", () => {
    const p = selectionToPlan({
      stations: [{ stationId: "fm-100-mul", recommendedSlots: [], audienceMatchScore: 90, rationale: "x" }],
      creators: [{ id: "multanfoodie", matchScore: 88, matchRationale: "y" }],
      budgetAllocation: { radio: 60, influencer: 30, platformFee: 10 },
    });
    expect((p.stationRecommendations as unknown[]).length).toBe(1);
    expect((p.influencerMatches as unknown[]).length).toBe(1);
    expect(p.budgetAllocation).toEqual({ radio: 60, influencer: 30, platformFee: 10 });
  });

  it("treats a missing array as an answer, not as damage", () => {
    // A radio-only brief returns no creators field. That is correct.
    const p = selectionToPlan({ stations: [], budgetAllocation: { radio: 90, influencer: 0, platformFee: 10 } });
    expect(p.influencerMatches).toEqual([]);
  });
});
