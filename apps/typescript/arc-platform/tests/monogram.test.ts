import { describe, it, expect } from "vitest";
import { monogramInitials, monogramTone } from "@/lib/monogram";

describe("initials read the way a person says the name", () => {
  it("skips the frequency, which is not part of the name", () => {
    expect(monogramInitials("City FM 89")).toBe("CF");
    expect(monogramInitials("MERA FM 107.4")).toBe("MF");
    expect(monogramInitials("Mast FM 103")).toBe("MF");
  });

  it("gives a one-word name its first two letters", () => {
    expect(monogramInitials("FM 100")).toBe("FM");
    expect(monogramInitials("FM91")).toBe("FM");
  });

  it("uses first names for people", () => {
    expect(monogramInitials("Ayesha Tariq")).toBe("AT");
    expect(monogramInitials("Sana Malik")).toBe("SM");
  });

  it("never returns empty", () => {
    expect(monogramInitials("107.4")).toBe("10");
    expect(monogramInitials("")).toBe("??");
  });
});

describe("colour is stable per entity", () => {
  it("gives the same id the same tone every time", () => {
    expect(monogramTone("fm-100-mul")).toBe(monogramTone("fm-100-mul"));
  });

  it("spreads different ids across the palette", () => {
    const ids = ["fm-100-mul", "city-fm-89-khi", "mera-fm-1074-khi", "fm-91-khi", "mast-fm-103-lhr", "sanalifestyle_pk"];
    expect(new Set(ids.map(monogramTone)).size).toBeGreaterThan(2);
  });

  it("only ever returns a design-system tone", () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      expect(monogramTone(id)).toMatch(/^bg-(lilac|blush|butter)(-deep)?$/);
    }
  });
});

/* profile-gen draws show names for a generated station. Three independent
   picks from eight names collide about a third of the time, which produced two
   shows called "Din Ka Aghaz" on one station and a duplicate-key error on its
   profile page. */
import { stationProfile } from "@/lib/profile-gen";

describe("a generated station has distinct shows", () => {
  const seed = (id: string) => ({
    externalId: id, name: "FM 100", channel: null, city: "Multan",
    frequency: "100.0 MHz", owner: null, handle: null, category: null,
    audience: null, rateEstimatePkr: null,
  });

  /* Two tests lived here guarding against a generated station getting the
     same invented show title or presenter twice. Both are gone with the
     names themselves - a daypart is a category, and there is nothing left to
     collide. Determinism is still worth holding. */
  it("stays deterministic for the same id", () => {
    const a = stationProfile(seed("fm-100-mul")).shows.map((s) => s.time);
    const b = stationProfile(seed("fm-100-mul")).shows.map((s) => s.time);
    expect(a).toEqual(b);
  });
});
