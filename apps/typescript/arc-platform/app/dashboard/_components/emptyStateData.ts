import type { TunerSegment } from "@/components/ui/tuner-strip";
import type { CallMoment } from "./SampleCall";
import { STATIONS } from "@/app/radio/_data";

const TONES = ["lilac", "blush", "butter"] as const;

/**
 * Real stations for the empty-state dial.
 *
 * These come from the app's station catalogue (app/radio/_data.ts) - the same
 * records the /radio page lists. They are NOT invented. They are also not from
 * the database: the schema has no Station model, so there is nothing to seed.
 * See the handover note.
 *
 * Weight is daily listeners, so segment widths read as relative audience -
 * the dial is measuring something, per BRANDING.md section 5.
 */
export function stationSegments(limit = 8): TunerSegment[] {
  // A dial reads frequencies. One record (Radio Pakistan) is listed as
  // "Multiple" rather than a single frequency, so it is left off the dial
  // rather than given a number it does not have.
  return STATIONS.filter(s => /^\d/.test(s.frequency))
    .slice(0, limit)
    .map((s, i) => ({
    id: s.id,
    label: s.frequency.replace(/\s*MHz$/i, ""),
    caption: s.name,
    weight: Math.max(1, Math.round(s.dailyListeners / 100_000)),
    tone: TONES[i % TONES.length],
  }));
}

/**
 * The sample call. Marked real:false, which renders the "Sample" pill.
 *
 * It can only ever be a sample right now - there is no calls table to read a
 * completed call from. The station and frequency are real records from the
 * catalogue so the sample is at least anchored in real inventory.
 */
export function sampleCallMoment(): CallMoment {
  const station = STATIONS[0];
  return {
    station: station.name,
    frequency: station.frequency.replace(/\s*MHz$/i, " FM"),
    duration: "1:47",
    quote:
      "Drive time is PKR 18,000 for a thirty-second spot. We have two slots open next week.",
    real: false,
  };
}
