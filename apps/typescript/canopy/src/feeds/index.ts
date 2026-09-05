import type { Config } from "../config.js";
import type { Playbook } from "../playbooks.js";
import type { HazardEvent, HazardId } from "../types.js";
import { fetchNwsAlerts, matchNwsAlerts } from "./nws.js";
import { evaluateHeatThreshold, fetchApparentTemperature } from "./open-meteo.js";

export interface DetectOptions {
  /** NWS: two-letter US state code, e.g. "AZ". */
  nwsArea?: string;
  /** Open-Meteo: coordinates plus a label for the area. */
  point?: { lat: number; lng: number; label: string };
  fetchImpl?: typeof fetch;
}

/** Polls the configured feeds once and returns every hazard event that should trigger a roll call. */
export async function detectEvents(config: Config, playbooks: Map<HazardId, Playbook>, options: DetectOptions): Promise<HazardEvent[]> {
  const events: HazardEvent[] = [];
  if (options.nwsArea) {
    const features = await fetchNwsAlerts({ area: options.nwsArea, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
    events.push(...matchNwsAlerts(features, playbooks, config.org, config.emergencyNumber));
  }
  if (options.point) {
    const heat = playbooks.get("heat");
    if (heat) {
      const forecast = await fetchApparentTemperature({ lat: options.point.lat, lng: options.point.lng, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
      const event = evaluateHeatThreshold(forecast, heat, options.point.label, config.org, config.emergencyNumber);
      if (event) {
        events.push(event);
      }
    }
  }
  return events;
}
