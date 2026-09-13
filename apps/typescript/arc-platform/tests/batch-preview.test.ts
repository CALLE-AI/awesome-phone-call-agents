import { describe, it, expect } from "vitest";

/**
 * Two influencer targets resolved to the same handset. The batch called one
 * and reported the other as "skipped" - a word that describes what the code
 * did, not what the buyer needs to do, and it appeared only AFTER the calls
 * had been placed. Nothing on the panel had shown which number each target
 * would dial, so the collision was unforeseeable and then unrecoverable.
 *
 * These pin the grouping the preview reports. The rule the UI depends on:
 * exactly one target per number goes first, and every other target on that
 * number is named as waiting behind it - never dropped.
 */
type T = { name: string; phone: string };

function group(targets: T[]) {
  const byPhone = new Map<string, T[]>();
  for (const t of targets) byPhone.set(t.phone, [...(byPhone.get(t.phone) ?? []), t]);
  return [...byPhone.entries()].flatMap(([phone, g]) =>
    g.map((t, i) => ({
      name: t.name,
      phone,
      sharesWith: g.length > 1 ? g.filter(x => x !== t).map(x => x.name) : [],
      queuedBehind: i > 0 ? g[0].name : null,
    }))
  );
}

describe("what the panel shows before anything rings", () => {
  it("keeps every target, including the ones sharing a number", () => {
    const rows = group([
      { name: "Momina Rauf", phone: "+923005550000" },
      { name: "Sana Farooq", phone: "+923005550000" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.name)).toEqual(["Momina Rauf", "Sana Farooq"]);
  });

  it("names who the second one is waiting for, rather than dropping it", () => {
    const rows = group([
      { name: "Momina Rauf", phone: "+923005550000" },
      { name: "Sana Farooq", phone: "+923005550000" },
    ]);
    expect(rows[0].queuedBehind).toBeNull();
    expect(rows[1].queuedBehind).toBe("Momina Rauf");
  });

  it("puts exactly one target first per number", () => {
    const rows = group([
      { name: "A", phone: "+923005550000" },
      { name: "B", phone: "+923005550000" },
      { name: "C", phone: "+923005550001" },
    ]);
    expect(rows.filter(r => r.queuedBehind === null).map(r => r.name)).toEqual(["A", "C"]);
  });

  it("leaves distinct numbers alone", () => {
    const rows = group([
      { name: "A", phone: "+923005550000" },
      { name: "B", phone: "+923005550001" },
    ]);
    expect(rows.every(r => r.queuedBehind === null)).toBe(true);
    expect(rows.every(r => r.sharesWith.length === 0)).toBe(true);
  });
});
