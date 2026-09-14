// Singapore NEA Pollutant Standards Index (24-hour PSI) from data.gov.sg. Free, no key.
// NEA's own guidance: at 24-hour PSI above 100, elderly people and those with chronic lung or
// heart disease should reduce prolonged or strenuous outdoor activity. The smoke playbook
// triggers on that threshold.

import type { Playbook } from "../playbooks.js";
import type { HazardEvent } from "../types.js";

export interface PsiReading {
  region: string;
  psi24h: number;
}

export interface PsiSnapshot {
  readings: PsiReading[];
  timestamp: string | null;
}

export const NEA_PSI_URL = "https://api-open.data.gov.sg/v2/real-time/api/psi";

export async function fetchNeaPsi(options: { fetchImpl?: typeof fetch } = {}): Promise<PsiSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(NEA_PSI_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`data.gov.sg returned ${response.status}`);
  }
  return parsePsiPayload((await response.json()) as unknown);
}

/** Pure: tolerant of the v1 and v2 payload shapes. */
export function parsePsiPayload(payload: unknown): PsiSnapshot {
  const root = (payload ?? {}) as { data?: { items?: unknown[] }; items?: unknown[] };
  const items = root.data?.items ?? root.items ?? [];
  const first = (items[0] ?? {}) as { timestamp?: string; updatedTimestamp?: string; readings?: { psi_twenty_four_hourly?: Record<string, number> } };
  const map = first.readings?.psi_twenty_four_hourly ?? {};
  const readings = Object.entries(map)
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([region, psi24h]) => ({ region, psi24h }));
  return { readings, timestamp: first.timestamp ?? first.updatedTimestamp ?? null };
}

/** Pure: does any region cross the playbook's PSI threshold? Returns the worst region as the event. */
export function evaluatePsi(snapshot: PsiSnapshot, playbook: Playbook, org: string, emergencyNumber: string): HazardEvent | null {
  const threshold = playbook.triggers.nea_psi?.psi_24h_at_least;
  if (threshold === undefined || snapshot.readings.length === 0) {
    return null;
  }
  const worst = [...snapshot.readings].sort((a, b) => b.psi24h - a.psi24h)[0];
  if (!worst || worst.psi24h < threshold) {
    return null;
  }
  const stamp = (snapshot.timestamp ?? new Date().toISOString()).slice(0, 13).replace(/[^0-9]/g, "");
  return {
    id: `nea-psi-${playbook.id}-${stamp}`,
    hazard: playbook.id,
    area: `Singapore (${worst.region})`,
    severity: worst.psi24h > 200 ? "Extreme" : worst.psi24h > 150 ? "Severe" : "Moderate",
    headline: `24-hour PSI ${worst.psi24h} in Singapore ${worst.region} region`,
    source: "nea-psi",
    startedAt: new Date().toISOString(),
    org,
    emergencyNumber,
    resource: null,
  };
}
