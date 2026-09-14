// Open-Meteo hourly apparent temperature (free, no key, global). Used where no official
// alert feed exists: a heat playbook triggers when the next 24 hours cross its threshold.

import type { Playbook } from "../playbooks.js";
import type { HazardEvent } from "../types.js";

export interface ApparentTemperatureForecast {
  maxApparentC: number;
  peakAt: string | null;
}

export async function fetchApparentTemperature(options: { lat: number; lng: number; fetchImpl?: typeof fetch }): Promise<ApparentTemperatureForecast> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    latitude: String(options.lat),
    longitude: String(options.lng),
    hourly: "apparent_temperature",
    forecast_days: "1",
    timezone: "auto",
  });
  const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo returned ${response.status}`);
  }
  const body = (await response.json()) as { hourly?: { time?: string[]; apparent_temperature?: (number | null)[] } };
  return summarizeApparentTemperature(body.hourly?.time ?? [], body.hourly?.apparent_temperature ?? []);
}

/** Pure: reduce an hourly series to its peak. */
export function summarizeApparentTemperature(times: string[], values: (number | null)[]): ApparentTemperatureForecast {
  let maxApparentC = Number.NEGATIVE_INFINITY;
  let peakAt: string | null = null;
  values.forEach((value, i) => {
    if (value !== null && value > maxApparentC) {
      maxApparentC = value;
      peakAt = times[i] ?? null;
    }
  });
  if (!Number.isFinite(maxApparentC)) {
    return { maxApparentC: Number.NaN, peakAt: null };
  }
  return { maxApparentC, peakAt };
}

/** Pure: does the forecast cross the playbook's threshold? */
export function evaluateHeatThreshold(forecast: ApparentTemperatureForecast, playbook: Playbook, area: string, org: string, emergencyNumber: string): HazardEvent | null {
  const threshold = playbook.triggers.open_meteo?.apparent_temperature_c_at_least;
  if (threshold === undefined || !Number.isFinite(forecast.maxApparentC) || forecast.maxApparentC < threshold) {
    return null;
  }
  const rounded = Math.round(forecast.maxApparentC);
  return {
    id: `open-meteo-${playbook.id}-${(forecast.peakAt ?? new Date().toISOString()).slice(0, 13).replace(/[^0-9]/g, "")}`,
    hazard: playbook.id,
    area,
    severity: rounded >= threshold + 5 ? "Extreme" : "Severe",
    headline: `Forecast apparent temperature of ${rounded} C in ${area}`,
    source: "open-meteo",
    startedAt: new Date().toISOString(),
    org,
    emergencyNumber,
    resource: null,
  };
}
