import type { Config } from "../config.js";
import type { Playbook } from "../playbooks.js";
import type { HazardEvent, HazardId } from "../types.js";
import { evaluatePsi, fetchNeaPsi } from "./nea-psi.js";
import { fetchNwsAlerts, matchNwsAlerts } from "./nws.js";
import { evaluateHeatThreshold, fetchApparentTemperature } from "./open-meteo.js";

export interface DetectOptions {
  /** NWS: two-letter US state code, e.g. "AZ". */
  nwsArea?: string;
  /** Open-Meteo: coordinates plus a label for the area. */
  point?: { lat: number; lng: number; label: string };
  /** Singapore NEA 24-hour PSI (smoke playbook). */
  neaPsi?: boolean;
  fetchImpl?: typeof fetch;
}

/** Polls the configured feeds once and returns every hazard event that should trigger a roll call. */
export async function detectEvents(config: Config, playbooks: Map<HazardId, Playbook>, options: DetectOptions): Promise<HazardEvent[]> {
  const events: HazardEvent[] = [];
  const fetchOpt = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
  if (options.nwsArea) {
    const features = await fetchNwsAlerts({ area: options.nwsArea, ...fetchOpt });
    events.push(...matchNwsAlerts(features, playbooks, config.org, config.emergencyNumber));
  }
  if (options.point) {
    const heat = playbooks.get("heat");
    if (heat) {
      const forecast = await fetchApparentTemperature({ lat: options.point.lat, lng: options.point.lng, ...fetchOpt });
      const event = evaluateHeatThreshold(forecast, heat, options.point.label, config.org, config.emergencyNumber);
      if (event) {
        events.push(event);
      }
    }
  }
  if (options.neaPsi) {
    const smoke = playbooks.get("smoke");
    if (smoke) {
      const snapshot = await fetchNeaPsi(fetchOpt);
      const event = evaluatePsi(snapshot, smoke, config.org, config.emergencyNumber);
      if (event) {
        events.push(event);
      }
    }
  }
  return events;
}
