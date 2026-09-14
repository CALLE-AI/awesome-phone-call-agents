import type { Vendor } from "./types";
import { isE164 } from "./phone";

// Find real businesses from OpenStreetMap (no API key). Only returns ones that
// actually list a phone number, since we need something to call.
type OverpassJson = { elements?: Array<{ tags?: Record<string, string> }> };

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// POST the query, trying mirrors until one returns JSON (Overpass often 504s).
async function overpass(query: string): Promise<OverpassJson> {
  let lastErr = "";
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "callsweep-hackathon/0.1",
        },
        body: "data=" + encodeURIComponent(query),
      });
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
        return (await res.json()) as OverpassJson;
      }
      lastErr = `${url} -> ${res.status}`;
    } catch (e) {
      lastErr = `${url} -> ${String(e).slice(0, 80)}`;
    }
  }
  throw new Error(`Overpass unavailable (${lastErr})`);
}

// Normalize to E.164, then STRICTLY validate. Returns null if not valid E.164,
// so a malformed listing can never reach CALL-E.
function toE164(raw: string, defaultCc = "1"): string | null {
  const trimmed = raw.trim();
  let candidate: string | null = null;

  if (trimmed.startsWith("+")) {
    candidate = "+" + trimmed.slice(1).replace(/\D/g, "");
  } else {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 10) candidate = `+${defaultCc}${digits}`; // US local
    else if (digits.length === 11 && digits.startsWith("1")) candidate = `+${digits}`;
  }

  return candidate && isE164(candidate) ? candidate : null;
}

// Map common LLM category words to the OSM tag value.
const ALIAS: Record<string, string> = {
  barber: "hairdresser",
  hair_salon: "hairdresser",
  salon: "hairdresser",
  auto_repair: "car_repair",
  mechanic: "car_repair",
  car_service: "car_repair",
};

export async function discoverVendors(
  category: string,
  lat: number,
  lon: number,
  radiusMeters = 4000,
  limit = 12
): Promise<Vendor[]> {
  const cat = ALIAS[category] ?? category;
  // Search both shop=* and amenity=* since categories fall under either.
  const query = `
    [out:json][timeout:25];
    (
      node["shop"="${cat}"]["phone"](around:${radiusMeters},${lat},${lon});
      node["shop"="${cat}"]["contact:phone"](around:${radiusMeters},${lat},${lon});
      node["amenity"="${cat}"]["phone"](around:${radiusMeters},${lat},${lon});
      node["amenity"="${cat}"]["contact:phone"](around:${radiusMeters},${lat},${lon});
    );
    out ${limit * 2};
  `;

  const json = await overpass(query);

  const vendors: Vendor[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    const name = t.name;
    const rawPhone = t.phone ?? t["contact:phone"];
    if (!name || !rawPhone) continue;
    const phoneE164 = toE164(rawPhone);
    if (!phoneE164) continue;

    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const address = [street, t["addr:city"]].filter(Boolean).join(", ") || undefined;

    vendors.push({ name, phoneE164, region: "US", address });
    if (vendors.length >= limit) break;
  }
  return vendors;
}

// Turn a place name into coordinates (Nominatim, no key).
async function geocode(place: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
  const res = await fetch(url, { headers: { "User-Agent": "callsweep-hackathon/0.1" } });
  if (!res.ok) return null;
  const j = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!j[0]) return null;
  return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
}

// Discover businesses for a category in a named location. Caches each unique
// (category, location) query to a file so repeat runs don't hit the network.
export async function discoverByRequest(
  category: string,
  location: string,
  limit = 6
): Promise<Vendor[]> {
  const cat = ALIAS[category] ?? category;
  const slug = `${cat}_${location}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const cacheFile = `fixtures/cache/${slug}.json`;

  const cached = Bun.file(cacheFile);
  if (await cached.exists()) return cached.json();

  const geo = await geocode(location);
  if (!geo) return [];

  const vendors = await discoverVendors(cat, geo.lat, geo.lon, 4000, limit);
  if (vendors.length > 0) {
    await Bun.write(cacheFile, JSON.stringify(vendors, null, 2));
  }
  return vendors;
}
