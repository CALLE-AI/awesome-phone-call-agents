// Facility discovery: pharmacies and blood banks from OpenStreetMap, plus Google Places when a key is
// configured. Discovery never dials anything. It signs each listed number so that "direct" routing
// can later prove the number came from this lookup.
import { signFacility } from "./discovery-signing";
import { callingCodeForCountry, maskPhone, toE164 } from "./phone";
import type { Facility, NeedKind } from "./types";

const USER_AGENT =
  "PharmaBridge/1.0 (CALL-E hackathon demo; +https://github.com/CALLE-AI/awesome-phone-call-agents)";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const OSM_FILTERS: Record<NeedKind, string[]> = {
  pharmacy: ['["amenity"="pharmacy"]'],
  blood_bank: ['["healthcare"="blood_donation"]', '["healthcare"="blood_bank"]', '["amenity"="blood_bank"]'],
};

const MAX_RESULTS = 24;

export interface GeoPoint {
  lat: number;
  lon: number;
  label: string;
  countryCode: string | null;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  rating?: number;
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

type Candidate = Omit<Facility, "distanceKm" | "bearingDeg" | "phoneMasked" | "signature">;

const geocodeCache = new Map<string, GeoPoint | null>();

export async function geocode(query: string): Promise<GeoPoint | null> {
  const key = query.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", addressdetails: "1", "accept-language": "en" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Geocoding failed with HTTP ${res.status}`);

  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; address?: { country_code?: string } }>;
  const hit = rows[0]
    ? {
        lat: Number(rows[0].lat),
        lon: Number(rows[0].lon),
        label: rows[0].display_name,
        countryCode: rows[0].address?.country_code?.toUpperCase() ?? null,
      }
    : null;
  geocodeCache.set(key, hit);
  return hit;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function formatAddress(tags: Record<string, string>): string {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const parts = [street, tags["addr:city"] ?? tags["addr:suburb"], tags["addr:postcode"]].filter(Boolean);
  return parts.length ? parts.join(", ") : "Address not listed";
}

async function queryOverpass(query: string): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        lastError = new Error(`Overpass HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { elements?: OverpassElement[] };
      return json.elements ?? [];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Overpass endpoints failed");
}

async function fromOpenStreetMap(kind: NeedKind, center: GeoPoint, radiusKm: number, callingCode: string) {
  const around = `(around:${Math.round(radiusKm * 1000)},${center.lat},${center.lon})`;
  const elements = await queryOverpass(`[out:json][timeout:25];(${OSM_FILTERS[kind].map((f) => `nwr${f}${around};`).join("")});out center tags;`);
  const candidates: Candidate[] = [];
  let withoutPhone = 0;
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const tags = el.tags ?? {};
    // A chemist tagged dispensing=no cannot fill a prescription, so it is never worth a call.
    if (kind === "pharmacy" && tags.dispensing === "no") continue;
    const phone = toE164(tags.phone ?? tags["contact:phone"], callingCode);
    if (!phone) {
      withoutPhone++;
      continue;
    }
    candidates.push({
      id: `osm:${el.type}/${el.id}`,
      kind,
      name: tags.name ?? tags.brand ?? (kind === "pharmacy" ? "Unnamed pharmacy" : "Unnamed blood bank"),
      brand: tags.brand ?? null,
      address: formatAddress(tags),
      lat,
      lon,
      phone,
      openingHours: tags.opening_hours ?? null,
      source: "openstreetmap",
      mapsUrl: null,
      rating: null,
      openNow: null,
    });
  }
  return { candidates, withoutPhone };
}

async function fromGooglePlaces(kind: NeedKind, center: GeoPoint, radiusKm: number, callingCode: string) {
  // Places is called server-side, so it needs a key without an HTTP-referrer restriction.
  const key = (process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY)?.trim();
  if (!key) return { candidates: [] as Candidate[], withoutPhone: 0 };

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.nationalPhoneNumber,places.googleMapsUri,places.rating,places.businessStatus,places.currentOpeningHours.openNow,places.currentOpeningHours.weekdayDescriptions,places.regularOpeningHours.weekdayDescriptions",
    },
    body: JSON.stringify({
      textQuery: kind === "pharmacy" ? "pharmacy" : "blood bank",
      ...(kind === "pharmacy" ? { includedType: "pharmacy" } : {}),
      locationBias: { circle: { center: { latitude: center.lat, longitude: center.lon }, radius: Math.min(radiusKm * 1000, 50_000) } },
      maxResultCount: 20,
      languageCode: "en",
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);

  const places = ((await res.json()) as { places?: GooglePlace[] }).places ?? [];
  // Google lists weekdays Monday-first; JavaScript's getDay() is Sunday-first.
  const todayIndex = (new Date().getDay() + 6) % 7;
  const candidates: Candidate[] = [];
  let withoutPhone = 0;
  for (const place of places) {
    if (!place.location || place.businessStatus === "CLOSED_PERMANENTLY") continue;
    const point = { lat: place.location.latitude, lon: place.location.longitude };
    if (haversineKm(center, point) > radiusKm * 1.25) continue;
    const phone = toE164(place.internationalPhoneNumber ?? place.nationalPhoneNumber, callingCode);
    if (!phone) {
      withoutPhone++;
      continue;
    }
    const hours = (place.currentOpeningHours ?? place.regularOpeningHours)?.weekdayDescriptions?.[todayIndex] ?? null;
    candidates.push({
      id: `google:${place.id}`,
      kind,
      name: place.displayName?.text ?? "Unnamed",
      brand: null,
      address: place.formattedAddress ?? "Address not listed",
      ...point,
      phone,
      openingHours: hours,
      source: "google",
      mapsUrl: place.googleMapsUri ?? null,
      rating: place.rating ?? null,
      openNow: place.currentOpeningHours?.openNow ?? null,
    });
  }
  return { candidates, withoutPhone };
}

function finalize(center: GeoPoint, candidates: Candidate[]): Facility[] {
  const seenPhones = new Set<string>();
  const facilities: Facility[] = [];
  for (const candidate of candidates) {
    if (!candidate.phone || seenPhones.has(candidate.phone)) continue;
    seenPhones.add(candidate.phone);
    facilities.push({
      ...candidate,
      distanceKm: haversineKm(center, candidate),
      bearingDeg: bearingDeg(center, candidate),
      phoneMasked: maskPhone(candidate.phone),
      signature: signFacility(candidate),
    });
  }
  return facilities.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, MAX_RESULTS);
}

export async function findFacilities(kind: NeedKind, center: GeoPoint, radiusKm: number) {
  const radius = Math.min(Math.max(radiusKm, 0.5), 25);
  const callingCode = callingCodeForCountry(center.countryCode) ?? "1";
  const [google, osm] = await Promise.allSettled([
    fromGooglePlaces(kind, center, radius, callingCode),
    fromOpenStreetMap(kind, center, radius, callingCode),
  ]);
  if (google.status === "rejected" && osm.status === "rejected") throw osm.reason;

  // Google results come first, so they win phone-number de-duplication (fresher hours and phones).
  const googleHits = google.status === "fulfilled" ? google.value : { candidates: [], withoutPhone: 0 };
  const osmHits = osm.status === "fulfilled" ? osm.value : { candidates: [], withoutPhone: 0 };
  const facilities = finalize(center, [...googleHits.candidates, ...osmHits.candidates]);
  return {
    facilities,
    withoutPhone: googleHits.withoutPhone + osmHits.withoutPhone,
    sources: [...new Set(facilities.map((f) => f.source))],
  };
}

const SYNTHETIC_NAMES: Record<NeedKind, string[]> = {
  pharmacy: [
    "Riverside Community Pharmacy",
    "Northgate Drug",
    "Maple & 3rd Pharmacy",
    "CityCare Pharmacy #214",
    "Harbor Health Pharmacy",
    "Lakeside Apothecary",
    "Union Square Chemists",
    "Sunrise 24h Pharmacy",
  ],
  blood_bank: [
    "City Central Blood Centre",
    "Lifeline Blood Bank",
    "General Hospital Blood Bank",
    "Riverside Voluntary Blood Bank",
    "Sanjeevani Blood Centre",
    "Metro Hospital Blood Bank",
    "Regional Blood Transfusion Centre",
    "Hope Voluntary Blood Bank",
  ],
};

/**
 * Clearly labelled fictional facilities (555-01xx numbers are reserved for fiction) used when map
 * data is unreachable or the operator picks the synthetic demo area. They are never signed, so they
 * can never be dialed directly.
 */
export function syntheticFacilities(kind: NeedKind, center: GeoPoint): Facility[] {
  return SYNTHETIC_NAMES[kind].map((name, i) => {
    const distanceKm = 0.6 + i * 0.55;
    const bearing = (i * 137.5) % 360;
    const phone = `+1212555${String((kind === "pharmacy" ? 110 : 150) + i).padStart(4, "0")}`;
    return {
      id: `synthetic:${kind}:${i}`,
      kind,
      name,
      brand: null,
      address: `${100 + i * 17} Example Ave`,
      lat: center.lat + (distanceKm / 111) * Math.cos(toRad(bearing)),
      lon: center.lon + ((distanceKm / 111) * Math.sin(toRad(bearing))) / Math.cos(toRad(center.lat)),
      distanceKm,
      bearingDeg: bearing,
      phone,
      phoneMasked: maskPhone(phone),
      openingHours: kind === "pharmacy" ? "Mo-Su 08:00-22:00" : "24/7",
      source: "synthetic" as const,
      mapsUrl: null,
      rating: null,
      openNow: null,
      signature: null,
    };
  });
}
