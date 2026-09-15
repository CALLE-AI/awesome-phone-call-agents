// Shortage Pulse: a shared, time-stamped map of what PharmaBridge calls actually heard, so the next
// family (and the next agent) can skip calls nobody needs to make. It is a projection of the call
// ledger: only schema-validated CALL-E results appear, never user input, and sightings carry no
// patient data, staff names, or quotes. For controlled medications only "not here" answers are
// published per pharmacy; where one is in stock stays an area-level count.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { haversineKm } from "./geo";
import { ledgerDir, readAllLedger, type LedgerEntry } from "./ledger";
import { freshHours, type PulseItemRow, type PulseSummary, type Sighting, type SightingStatus } from "./pulse-item";
import { parseBloodInquiryResult, parseInquiryResult } from "./result-validation";
import { signalsFromBlood, signalsFromInquiry, tierOfSignals, type Tier } from "./scoring";
import type { NeedKind } from "./types";

const STATUS_OF: Partial<Record<Tier, SightingStatus>> = {
  confirmed: "available",
  partial: "partial",
  alternative: "alternative",
  out: "out",
  refused: "refused",
};

export function sightingFromEntry(entry: LedgerEntry, now = Date.now()): Sighting | null {
  if ((entry.kind !== "inquiry" && entry.kind !== "blood_inquiry") || !entry.item || !entry.call) return null;
  // Publish only what the facility itself said: a live call to its own listed number, or a fictional
  // demo-area facility. A simulated or test-line answer about a real business would be false.
  const fictional = entry.facility.source === "synthetic" || entry.facility.id.startsWith("synthetic:");
  if (!fictional && !(entry.mode === "live" && entry.routing === "direct")) return null;
  const { lat, lon } = entry.facility;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  const kind: NeedKind = entry.kind === "blood_inquiry" ? "blood_bank" : "pharmacy";
  let status: SightingStatus | undefined;
  let quantity = "";
  let restock = "";
  if (kind === "blood_bank") {
    const result = parseBloodInquiryResult(entry.call.structuredResult);
    if (!result) return null;
    status = STATUS_OF[tierOfSignals(signalsFromBlood(result), false)];
    quantity = result.units_available;
    restock = result.referral_or_restock;
  } else {
    const result = parseInquiryResult(entry.call.structuredResult);
    if (!result) return null;
    status = STATUS_OF[tierOfSignals(signalsFromInquiry(result), false)];
    quantity = result.stock_status === "out_of_stock" ? result.alternative_details : result.quantity_on_hand;
    restock = result.restock_eta;
  }
  if (!status) return null;

  const observedAt = entry.call.completedAt ?? entry.updatedAt;
  if (now - Date.parse(observedAt) > freshHours(kind, status) * 3_600_000) return null;

  const withheld = entry.item.controlled && status !== "out" && status !== "refused";
  return {
    id: entry.key,
    kind,
    item: entry.item,
    facilityId: withheld ? null : entry.facility.id,
    facilityName: withheld ? null : entry.facility.name,
    // Withheld sightings snap to a ~1 km grid, so the map shows an area rather than a store.
    lat: withheld ? Math.round(lat * 100) / 100 : lat,
    lon: withheld ? Math.round(lon * 100) / 100 : lon,
    status,
    quantity: withheld ? "" : quantity,
    restock,
    observedAt,
    live: entry.mode === "live",
  };
}

interface PulseState {
  at: number;
  sightings: Sighting[];
  avoided: Map<string, number> | null;
}

const holder = globalThis as unknown as { __pharmabridgePulse?: PulseState };
const pulseState = () => (holder.__pharmabridgePulse ??= { at: 0, sightings: [], avoided: null });

/** Fresh sightings, newest first, one per item and facility. */
export async function allSightings(now = Date.now()): Promise<Sighting[]> {
  const state = pulseState();
  if (now - state.at < 3000) return state.sightings;
  const seen = new Set<string>();
  const sightings: Sighting[] = [];
  for (const entry of await readAllLedger()) {
    const sighting = sightingFromEntry(entry, now);
    if (!sighting) continue;
    const key = `${sighting.item.key}|${sighting.facilityId ?? sighting.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sightings.push(sighting);
  }
  sightings.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  state.at = now;
  state.sightings = sightings;
  return sightings;
}

export function summarize(sightings: Sighting[]): PulseSummary {
  const count = (status: SightingStatus) => sightings.filter((s) => s.status === status).length;
  return {
    answers: sightings.length,
    available: count("available"),
    partial: count("partial"),
    alternative: count("alternative"),
    out: count("out"),
    refused: count("refused"),
    withheld: sightings.filter((s) => s.facilityId === null).length,
    restock: [...new Set(sightings.map((s) => s.restock).filter(Boolean))].slice(0, 4),
    newestAt: sightings[0]?.observedAt ?? null,
  };
}

export function byItem(sightings: Sighting[]): PulseItemRow[] {
  const groups = new Map<string, Sighting[]>();
  for (const s of sightings) groups.set(s.item.key, [...(groups.get(s.item.key) ?? []), s]);
  return [...groups.values()]
    .map((group) => ({ item: group[0].item, kind: group[0].kind, summary: summarize(group) }))
    .sort((a, b) => b.summary.answers - a.summary.answers || (b.summary.newestAt ?? "").localeCompare(a.summary.newestAt ?? ""));
}

export async function pulseNear(query: { kind?: NeedKind; itemKey?: string; lat?: number; lon?: number; radiusKm?: number }) {
  const { kind, itemKey, lat, lon } = query;
  const radiusKm = query.radiusKm ?? 5;
  const sightings = (await allSightings()).filter(
    (s) =>
      (!kind || s.kind === kind) &&
      (!itemKey || s.item.key === itemKey) &&
      (lat === undefined || lon === undefined || haversineKm({ lat, lon }, s) <= radiusKm * 1.25),
  );
  return { sightings, summary: summarize(sightings) };
}

// Calls avoided: each mission reports how many recently-answered facilities it skipped. Stored per
// mission id, so replaying a report cannot inflate the total.
const statsFile = () => path.join(path.dirname(ledgerDir()), "pulse-stats.json");

async function avoidedMap(): Promise<Map<string, number>> {
  const state = pulseState();
  if (state.avoided) return state.avoided;
  try {
    state.avoided = new Map(Object.entries(JSON.parse(await readFile(statsFile(), "utf8")) as Record<string, number>));
  } catch {
    state.avoided = new Map();
  }
  return state.avoided;
}

export async function avoidedTotal(): Promise<number> {
  return [...(await avoidedMap()).values()].reduce((sum, n) => sum + n, 0);
}

export async function recordAvoided(missionId: string, avoided: number): Promise<number> {
  const map = await avoidedMap();
  map.set(missionId, avoided);
  if (map.size > 5000) map.delete(map.keys().next().value as string);
  try {
    await writeFile(statsFile(), JSON.stringify(Object.fromEntries(map)), "utf8");
  } catch {
    // A read-only filesystem keeps the in-memory total.
  }
  return avoidedTotal();
}
