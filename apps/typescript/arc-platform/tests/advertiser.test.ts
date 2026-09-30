import { describe, it, expect } from "vitest";
import { advertiserName } from "@/lib/advertiser";

/**
 * The first sentence of every call. On 5 September a real call to FM 101
 * opened "calling on behalf of It's our founder Birthday Month" - the campaign
 * name, used whole because it had no dash to split on, while the brand
 * "Coac Tal" sat unread on the same record.
 */
describe("who the agent says it is calling for", () => {
  it("uses the brand when the campaign name is a slogan", () => {
    expect(advertiserName("It's our founder Birthday Month", "Coac Tal")).toBe("Coac Tal");
  });

  it("never opens a call with a campaign introducing itself as a company", () => {
    const said = advertiserName("It's our founder Birthday Month", "Coac Tal");
    expect(said).not.toMatch(/birthday/i);
  });

  /* The other half of the trade. This campaign's brand is the name of the
     person who signed up, so preferring the brand everywhere would swap one
     wrong opening for another. */
  it("keeps the brand out of it when the campaign name already names one", () => {
    expect(advertiserName("Zeb Modest Wear — Eid 2026", "Sejafah Abroo")).toBe("Zeb Modest Wear");
  });

  it("splits on an em dash, en dash or spaced hyphen", () => {
    expect(advertiserName("Shan Foods — Ramzan", "B")).toBe("Shan Foods");
    expect(advertiserName("Shan Foods – Ramzan", "B")).toBe("Shan Foods");
    expect(advertiserName("Shan Foods - Ramzan", "B")).toBe("Shan Foods");
  });

  it("does not cut a hyphenated word in half", () => {
    expect(advertiserName("Eid-ul-Fitr Push", "Coac Tal")).toBe("Coac Tal");
  });

  it("falls back to the campaign name when there is no brand to use", () => {
    expect(advertiserName("Tan", null)).toBe("Tan");
    expect(advertiserName("Tan")).toBe("Tan");
    expect(advertiserName("Tan", "   ")).toBe("Tan");
  });

  it("trims, so the agent never says a name with a trailing space", () => {
    expect(advertiserName("Iphone 18 ", "")).toBe("Iphone 18");
    expect(advertiserName("  Zeb Modest Wear  —  Eid  ", "B")).toBe("Zeb Modest Wear");
  });
});
