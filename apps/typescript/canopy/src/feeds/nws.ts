// US National Weather Service active alerts (api.weather.gov). Free, no key, requires a User-Agent.

import type { Playbook } from "../playbooks.js";
import type { HazardEvent, HazardId } from "../types.js";

export interface NwsFeature {
  id: string;
  properties: {
    event: string;
    headline: string | null;
    severity: string | null;
    areaDesc: string | null;
    onset: string | null;
    expires: string | null;
    status?: string;
    messageType?: string;
  };
}

export const NWS_USER_AGENT = "canopy-hazard-roll-call (awesome-phone-call-agents community app)";

export async function fetchNwsAlerts(options: { area?: string; point?: string; fetchImpl?: typeof fetch }): Promise<NwsFeature[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const params = new URLSearchParams({ status: "actual", message_type: "alert" });
  if (options.point) {
    params.set("point", options.point);
  } else if (options.area) {
    params.set("area", options.area);
  } else {
    throw new Error("fetchNwsAlerts needs an area (state code) or a point (lat,lng).");
  }
  const response = await fetchImpl(`https://api.weather.gov/alerts/active?${params.toString()}`, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
  });
  if (!response.ok) {
    throw new Error(`NWS returned ${response.status}`);
  }
  const body = (await response.json()) as { features?: NwsFeature[] };
  return body.features ?? [];
}

/** Pure: which active alerts match which playbook. */
export function matchNwsAlerts(features: NwsFeature[], playbooks: Map<HazardId, Playbook>, org: string, emergencyNumber: string): HazardEvent[] {
  const events: HazardEvent[] = [];
  for (const feature of features) {
    for (const playbook of playbooks.values()) {
      if (!playbook.triggers.nws_events.includes(feature.properties.event)) {
        continue;
      }
      events.push({
        id: `nws-${feature.id.split("/").pop() ?? feature.id}`,
        hazard: playbook.id,
        area: feature.properties.areaDesc ?? "unknown area",
        severity: feature.properties.severity ?? "Unknown",
        headline: feature.properties.headline ?? feature.properties.event,
        source: "nws",
        startedAt: feature.properties.onset ?? new Date().toISOString(),
        org,
        emergencyNumber,
        resource: null,
      });
    }
  }
  return events;
}
