import { describe, expect, it } from "vitest";
import { evaluate, resequence, type ResequenceInput, type RouteStopInput } from "../src/core/resequence.js";
import { TravelTimes } from "../src/core/travel.js";

/** Straight-line driving where one unit of distance takes one minute. */
function travelFor(points: Record<string, [number, number]>): TravelTimes {
  const ids = Object.keys(points);
  const durationsSeconds = ids.map((from) =>
    ids.map((to) => Math.hypot(points[from][0] - points[to][0], points[from][1] - points[to][1]) * 60),
  );
  return new TravelTimes({ ids, durationsSeconds, distancesMeters: durationsSeconds, shapes: {} }, 1);
}

function stop(id: string, overrides: Partial<RouteStopInput> = {}): RouteStopInput {
  return { id, serviceMinutes: 4, earliest: null, windowEnd: null, ...overrides };
}

describe("resequence", () => {
  const travel = travelFor({ hub: [0, 0], a: [3, 0], b: [4, 0], c: [6, 0] });

  it("keeps the current order when nothing constrains it", () => {
    const result = resequence({ from: "hub", now: 0, current: [stop("a"), stop("b"), stop("c")], travel });
    expect(result.changed).toBe(false);
    expect(result.best.order).toEqual(["a", "b", "c"]);
  });

  it("serves ready customers first while one who needs time gets ready", () => {
    const result = resequence({
      from: "hub",
      now: 0,
      current: [stop("a", { earliest: 20 }), stop("b"), stop("c")],
      travel,
    });
    expect(result.changed).toBe(true);
    expect(result.best.order.at(-1)).toBe("a");
    expect(result.savedMinutes).toBeCloseTo(11);
  });

  it("moves a stop up to keep its promised window", () => {
    const line = travelFor({ hub: [0, 0], a: [5, 0], b: [10, 0] });
    const result = resequence({
      from: "hub",
      now: 0,
      current: [stop("a"), stop("b", { windowEnd: 10 })],
      travel: line,
    });
    expect(result.best.order).toEqual(["b", "a"]);
    expect(result.best.lateness).toBe(0);
  });

  it("finds the same cost as an exhaustive search on random days", () => {
    const random = seeded(42);
    for (let trial = 0; trial < 40; trial++) {
      const ids = ["s1", "s2", "s3", "s4", "s5", "s6"];
      const points: Record<string, [number, number]> = { hub: [0, 0] };
      for (const id of ids) points[id] = [random() * 20, random() * 20];
      const current = ids.map((id) =>
        stop(id, {
          serviceMinutes: 3 + Math.floor(random() * 4),
          earliest: random() < 0.4 ? Math.floor(random() * 60) : null,
          windowEnd: random() < 0.4 ? 30 + Math.floor(random() * 90) : null,
        }),
      );
      const input: ResequenceInput = { from: "hub", now: 0, current, travel: travelFor(points) };
      const exhaustive = Math.min(...permutations(current).map((order) => evaluate(order, input).cost));
      expect(resequence(input).best.cost).toBeCloseTo(exhaustive, 6);
    }
  });
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
