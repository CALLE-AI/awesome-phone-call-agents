import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TravelTimes } from "./travel.js";
import type { DayFixture, Travel } from "./types.js";

export const DEFAULT_DAY = fileURLToPath(new URL("../../fixtures/day-dhaka.json", import.meta.url));

export interface LoadedDay {
  day: DayFixture;
  travel: TravelTimes;
  /** Travel data as saved, including road shapes for the map. */
  raw: Travel;
}

/** Loads a fixture day and the travel data saved next to it by scripts/build-travel.ts. */
export function loadDay(fixturePath = DEFAULT_DAY, trafficFactor?: number): LoadedDay {
  const day = JSON.parse(readFileSync(fixturePath, "utf8")) as DayFixture;
  const raw = JSON.parse(readFileSync(fixturePath.replace(/\.json$/, ".travel.json"), "utf8")) as Travel;
  return { day, raw, travel: new TravelTimes(raw, trafficFactor) };
}
