import { describe, it, expect } from "vitest";
import {
  toRow,
  filterCreators,
  type DirectoryCreator,
  type CreatorFilters,
} from "@/app/influencers/_components/InfluencerMarket";
import type { Creator } from "@/app/influencers/_data";

/**
 * The directory listed the eight creators in _data.ts and called that the
 * market - "32 verified" in the header over eight cards - while plan
 * generation was already recommending the other 24. Listing all 32 means most
 * rows now have no engagement rate, no rating and no reviews, and the danger
 * is not that those look empty. It is that a filter or a sort quietly treats
 * "not on file" as a value: 0% engagement, PKR 0 per post, unverified-as-fact.
 */
const documented = {
  id: "sanalifestyle_pk", username: "sanalifestyle_pk", displayName: "Sana Malik",
  platforms: ["instagram"], primaryPlatform: "instagram", niche: ["Lifestyle"],
  city: "Karachi", followers: 48_000, allFollowers: [], engagementRate: 7.2,
  avgViews: 34_000, audienceFemale: 71, audienceAgeRange: "28-42", audienceCities: [],
  pricePost: 18_000, priceStory: 8_000, isVerified: true, isAvailableNow: true,
  hasReviews: true, languages: ["Urdu"], bio: "", contentTypes: [], responseTime: "",
  campaignsDone: 4, rating: 4.8, aiMatchScore: 91, aiMatchRationale: "",
  demographics: { age: [], topCities: [] }, reviews: [],
} as unknown as Creator;

const withWriteup: DirectoryCreator = {
  externalId: "sanalifestyle_pk", name: "Sana Malik", handle: "sanalifestyle_pk",
  channel: "instagram", city: "Karachi", category: "Lifestyle", audience: 48_000,
  audienceBasis: "followers", rateEstimatePkr: 18_000, hasPhone: true, detail: documented,
};

/** One of the 24: a real person, a real number, and nothing else on file. */
const bare: DirectoryCreator = {
  externalId: "multanfoodie", name: "Multan Foodie", handle: "multanfoodie",
  channel: "tiktok", city: "Multan", category: "Food", audience: null,
  audienceBasis: "followers", rateEstimatePkr: null, hasPhone: true, detail: null,
};

const defaults: CreatorFilters = {
  search: "", platforms: [], niches: [], cities: [], followerRange: "any",
  engRange: "any", priceRange: "any", onlyVerified: false, onlyAvailable: false, femaleOnly: false, maleOnly: false, languages: [], sort: "match",
};
const run = (items: DirectoryCreator[], f: Partial<CreatorFilters> = {}) =>
  filterCreators(items.map(toRow), { ...defaults, ...f });

describe("a creator we have not written up gets absence, not a default", () => {
  it("leaves engagement, audience split and match score null rather than zero", () => {
    const r = toRow(bare);
    expect(r.engagementRate).toBeNull();
    expect(r.audienceFemale).toBeNull();
    expect(r.aiMatchScore).toBeNull();
    // Not zero: a 0% engagement rate on a real person's card is a claim.
    expect(r.engagementRate).not.toBe(0);
  });

  it("leaves the rate null rather than PKR 0", () => {
    expect(toRow(bare).pricePost).toBeNull();
  });

  it("still knows what the Contact table holds", () => {
    const r = toRow(bare);
    expect(r.platforms).toEqual(["tiktok"]);
    expect(r.niche).toEqual(["Food"]);
    expect(r.city).toBe("Multan");
  });

  it("claims no verification or availability it cannot support", () => {
    const r = toRow(bare);
    expect(r.isVerified).toBe(false);
    expect(r.isAvailableNow).toBe(false);
  });
});

describe("a filter about missing data excludes the row instead of guessing", () => {
  it("does not return an unmeasured creator for an engagement band", () => {
    expect(run([withWriteup, bare], { engRange: "great" }).map(c => c.externalId)).toEqual([]);
    expect(run([withWriteup, bare], { engRange: "good" }).map(c => c.externalId)).toEqual(["sanalifestyle_pk"]);
  });

  it("does not return an unpriced creator for a price band", () => {
    // The trap: an absent rate read as 0 would match "Under PKR 10K".
    expect(run([withWriteup, bare], { priceRange: "budget" }).map(c => c.externalId)).toEqual([]);
  });

  it("does not return a creator with no follower count for a size band", () => {
    expect(run([withWriteup, bare], { followerRange: "nano" }).map(c => c.externalId)).toEqual([]);
  });

  it("does not treat an unknown audience split as a male audience", () => {
    expect(run([withWriteup, bare], { maleOnly: true }).map(c => c.externalId)).toEqual([]);
  });

  it("keeps filtering on what the Contact table does hold", () => {
    expect(run([withWriteup, bare], { cities: ["Multan"] }).map(c => c.externalId)).toEqual(["multanfoodie"]);
    expect(run([withWriteup, bare], { platforms: ["tiktok"] }).map(c => c.externalId)).toEqual(["multanfoodie"]);
    expect(run([withWriteup, bare], { search: "foodie" }).map(c => c.externalId)).toEqual(["multanfoodie"]);
  });
});

describe("unknown sorts last, never first", () => {
  it("does not put an unpriced creator at the top of cheapest-first", () => {
    expect(run([bare, withWriteup], { sort: "price-low" }).map(c => c.externalId))
      .toEqual(["sanalifestyle_pk", "multanfoodie"]);
  });

  it("does not put an unmeasured creator at the top of engagement", () => {
    expect(run([bare, withWriteup], { sort: "engagement" }).map(c => c.externalId))
      .toEqual(["sanalifestyle_pk", "multanfoodie"]);
  });

  it("does not put an unknown follower count at the top of followers", () => {
    expect(run([bare, withWriteup], { sort: "followers" }).map(c => c.externalId))
      .toEqual(["sanalifestyle_pk", "multanfoodie"]);
  });

  it("lists everyone when no filter asks about missing data", () => {
    expect(run([withWriteup, bare]).length).toBe(2);
  });
});
