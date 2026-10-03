import type { Travel } from "./types.js";

/** Driving times between fixture points: free-flow OSRM times scaled by a traffic factor. */
export class TravelTimes {
  private readonly index = new Map<string, number>();

  /** @param trafficFactor multiplier on free-flow time; 2 roughly matches midday Dhaka motorbike traffic */
  constructor(
    private readonly travel: Travel,
    readonly trafficFactor = 2,
  ) {
    travel.ids.forEach((id, i) => this.index.set(id, i));
  }

  minutes(from: string, to: string): number {
    if (from === to) return 0;
    return (this.travel.durationsSeconds[this.at(from)][this.at(to)] * this.trafficFactor) / 60;
  }

  meters(from: string, to: string): number {
    if (from === to) return 0;
    return this.travel.distancesMeters[this.at(from)][this.at(to)];
  }

  /** Road shape as [lat, lng] pairs; empty when the fixture has none. */
  shape(from: string, to: string): [number, number][] {
    return this.travel.shapes[`${from}>${to}`] ?? [];
  }

  private at(id: string): number {
    const i = this.index.get(id);
    if (i === undefined) throw new Error(`Unknown point: ${id}`);
    return i;
  }
}
