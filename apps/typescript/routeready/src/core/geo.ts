import { TravelTimes } from "./travel.js";
import type { GeoPoint } from "./types.js";

/** Roads are longer than a straight line; 1.35 is a common urban detour factor. */
export const ROAD_FACTOR = 1.35;

/** Straight-line distance in metres between two points. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radius = 6_371_000;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Travel times between arbitrary points, estimated from road-adjusted
 * straight-line distance at a steady speed. Used where no road data was
 * downloaded in advance, so the same re-ordering search works on any stops.
 */
export function estimatedTravel(points: GeoPoint[], speedKmh: number): TravelTimes {
  const metersPerSecond = (speedKmh * 1000) / 3600;
  const distancesMeters = points.map((from) => points.map((to) => haversineMeters(from, to) * ROAD_FACTOR));
  return new TravelTimes(
    {
      ids: points.map((point) => point.id),
      distancesMeters,
      durationsSeconds: distancesMeters.map((row) => row.map((meters) => meters / metersPerSecond)),
      shapes: {},
    },
    1,
  );
}
