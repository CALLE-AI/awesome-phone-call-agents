import type { BusinessCandidate, CandidateSourceRef } from '@dial/schemas';
import { normalizePhone, isBlockedNumber } from '@dial/domain';
import { logger } from '@dial/observability';
import { safeFetchJson, throttleHost } from './http.js';
import { resolveDomainMapping } from './categories.js';
import {
  DiscoveryError,
  type BusinessDiscoveryProvider,
  type DiscoveryQuery,
  type GeocodeResult,
  type GeocodingProvider,
} from './types.js';

/**
 * OpenStreetMap providers. Real internet data, no API key.
 *
 * - Nominatim for geocoding.
 * - Overpass for business discovery, reading the `phone` / `contact:phone` tags
 *   that OSM contributors maintain.
 *
 * Both services are free and their usage policies require an identifying
 * User-Agent with a contact address, plus conservative request rates -- both of
 * which are enforced here rather than left to the caller. ODbL attribution is
 * carried through on every candidate via `sourceUrl`.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
/**
 * Overpass mirrors, tried in order. The main instance returns 504 under load
 * often enough that relying on a single endpoint is an availability problem.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function userAgent(contactEmail: string): string {
  // Nominatim rejects generic agents. A real contact address is required.
  const contact = contactEmail || 'unconfigured@example.invalid';
  return `Dial/1.0 (+https://github.com/dial-app; ${contact})`;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
  addresstype?: string;
  extratags?: Record<string, string>;
  /** [minLat, maxLat, minLon, maxLon] as strings. */
  boundingbox?: string[];
}

/** Widest dimension of a Nominatim bounding box, in kilometres. */
function spanKmOf(place: NominatimPlace): number | null {
  const bb = place.boundingbox?.map(Number);
  if (!bb || bb.length !== 4 || bb.some((n) => !Number.isFinite(n))) return null;
  const [minLat, maxLat, minLon, maxLon] = bb as [number, number, number, number];
  const latKm = (maxLat - minLat) * 111;
  const lonKm = (maxLon - minLon) * 111 * Math.cos((minLat * Math.PI) / 180);
  return Math.round(Math.max(latKm, Math.abs(lonKm)));
}

/** Nominatim's box, reordered to [south, north, west, east] numbers. */
function boundingBoxOf(place: NominatimPlace): [number, number, number, number] | null {
  const bb = place.boundingbox?.map(Number);
  if (!bb || bb.length !== 4 || bb.some((n) => !Number.isFinite(n))) return null;
  const [minLat, maxLat, minLon, maxLon] = bb as [number, number, number, number];
  return [minLat, maxLat, minLon, maxLon];
}

export class NominatimGeocoder implements GeocodingProvider {
  readonly name = 'nominatim';

  constructor(private readonly contactEmail: string) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    if (!query.trim()) return null;
    await throttleHost('nominatim.openstreetmap.org', 1100);

    const url = `${NOMINATIM}/search?format=jsonv2&limit=1&addressdetails=1&extratags=1&accept-language=en&q=${encodeURIComponent(query)}`;
    const places = await safeFetchJson<NominatimPlace[]>(url, {
      headers: { 'User-Agent': userAgent(this.contactEmail), Accept: 'application/json' },
    });

    const place = places[0];
    if (!place) return null;
    return {
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      label: place.display_name,
      countryCode: place.address?.['country_code']?.toUpperCase() ?? null,
      addressType: place.addresstype ?? null,
      spanKm: spanKmOf(place),
      timezone: place.extratags?.['timezone'] ?? null,
      capitalCity: place.extratags?.['capital_city'] ?? null,
      boundingBox: boundingBoxOf(place),
    };
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    await throttleHost('nominatim.openstreetmap.org', 1100);

    const url = `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&accept-language=en&lat=${latitude}&lon=${longitude}`;
    const place = await safeFetchJson<NominatimPlace | { error: string }>(url, {
      headers: { 'User-Agent': userAgent(this.contactEmail), Accept: 'application/json' },
    });

    if (!place || 'error' in place) return null;
    return {
      latitude,
      longitude,
      // A full postal address is more than the user needs; keep it short.
      label: shortLabel(place),
      countryCode: place.address?.['country_code']?.toUpperCase() ?? null,
      // Reverse geocoding starts from a real coordinate, so precision is not
      // in question the way it is for a typed place name.
      addressType: place.addresstype ?? null,
      spanKm: null,
    };
  }
}

function shortLabel(place: NominatimPlace): string {
  const a = place.address ?? {};
  const parts = [
    a['suburb'] ?? a['neighbourhood'] ?? a['city_district'],
    a['city'] ?? a['town'] ?? a['village'] ?? a['county'],
    a['country'],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : place.display_name;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export class OverpassDiscoveryProvider implements BusinessDiscoveryProvider {
  readonly name = 'osm';

  constructor(private readonly contactEmail: string) {}

  isConfigured(): boolean {
    // Overpass itself needs no key, but the usage policy requires a contact.
    return true;
  }

  async discover(query: DiscoveryQuery): Promise<BusinessCandidate[]> {
    const mapping = resolveDomainMapping(query.domain, query.query);
    const radius = Math.min(Math.max(query.radiusMeters, 500), 50_000);
    const around = `(around:${radius},${query.latitude},${query.longitude})`;

    const clauses: string[] = [];
    for (const [key, value] of mapping.osmTags) {
      for (const type of ['node', 'way']) {
        clauses.push(`${type}["${escapeOverpass(key)}"="${escapeOverpass(value)}"]${around};`);
      }
    }
    // No tag mapping for this domain. Guess the tag before giving up: the
    // interpreter emits OSM-flavoured snake_case keys ("bakery", "car_wash"),
    // which are frequently the literal OSM value. These are indexed lookups, so
    // a wrong guess costs almost nothing and a right one is exact.
    //
    // What is deliberately NOT done here is a bare `["name"~"..."]` regex.
    // Overpass has no index for it and scans every element in the radius --
    // measured at 55 seconds with no result for a 3 km radius in central Paris.
    const guessedFromDomain = clauses.length === 0;
    if (guessedFromDomain) {
      const guess = query.domain.toLowerCase().replace(/[^a-z_]/g, '');
      if (guess) {
        for (const key of ['shop', 'amenity', 'craft', 'leisure', 'healthcare']) {
          clauses.push(`nwr["${key}"="${escapeOverpass(guess)}"]${around};`);
        }
      }
    }

    // Nothing to guess with either: fall straight to free-text search, which is
    // what Nominatim is actually built for.
    if (clauses.length === 0) {
      return searchByText(this.contactEmail, query, mapping.keywords);
    }

    const overpassQl = `[out:json][timeout:25];(${clauses.join('')});out center tags ${Math.min(query.limit * 4, 120)};`;

    await throttleHost('overpass-api.de', 1200);

    // The main Overpass instance returns 504 under load often enough that a
    // single endpoint is an availability problem in itself, so try a mirror.
    let response: { elements?: OverpassElement[] } | null = null;
    let lastError: unknown = null;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        response = await safeFetchJson<{ elements?: OverpassElement[] }>(endpoint, {
          method: 'POST',
          headers: {
            'User-Agent': userAgent(this.contactEmail),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `data=${encodeURIComponent(overpassQl)}`,
          timeoutMs: 30_000,
        });
        break;
      } catch (error) {
        lastError = error;
        logger.warn('overpass endpoint failed', {
          endpoint,
          error: (error as Error).message,
        });
        // A rejected query fails identically everywhere; only try a mirror when
        // the endpoint itself was the problem.
        if (error instanceof DiscoveryError && !error.retryable) throw error;
      }
    }

    if (!response) {
      if (lastError instanceof DiscoveryError) throw lastError;
      throw new DiscoveryError(
        'provider_unavailable',
        (lastError as Error)?.message ?? 'Overpass was unreachable.',
        true,
      );
    }

    const candidates: BusinessCandidate[] = [];
    for (const element of response.elements ?? []) {
      const candidate = toCandidate(element, query.countryCode);
      if (candidate) candidates.push(candidate);
    }

    logger.info('osm discovery complete', {
      domain: query.domain,
      found: candidates.length,
      withPhone: candidates.filter((c) => c.phoneE164).length,
      radius,
      guessedFromDomain,
    });

    // The guess missed. Try free text before concluding nothing is there.
    if (candidates.length === 0 && guessedFromDomain) {
      return searchByText(this.contactEmail, query, mapping.keywords);
    }

    return candidates;
  }
}

export interface MajorCity {
  name: string;
  latitude: number;
  longitude: number;
  population: number;
}

/**
 * The biggest cities in and around a country, ranked by population, from
 * OpenStreetMap.
 *
 * Used so that being told "Saudi Arabia" does not have to become a question.
 * Searching a country's geometric centroid is useless -- it is usually empty
 * countryside -- but its biggest city is a defensible place to start, provided
 * the user is told that is what happened.
 *
 * Two ways of restricting to the country, and the cheap one is preferred:
 *
 *  - A bounding box, when the geocoder gave one. Overpass indexes coordinates,
 *    so this answers in a couple of seconds. The box is not the border, so the
 *    list can include neighbours -- a box around Finland also contains Saint
 *    Petersburg -- which is why this returns a ranked list for the caller to
 *    filter rather than a single answer it cannot vouch for.
 *  - The country's ISO area, otherwise. Exact, but it makes Overpass resolve a
 *    whole national boundary before it can start, which in measurement was slow
 *    enough to time out on large countries.
 */
export async function findMajorCities(
  contactEmail: string,
  countryCode: string,
  boundingBox: [number, number, number, number] | null = null,
): Promise<MajorCity[]> {
  const cc = countryCode.toUpperCase().replace(/[^A-Z]/g, '');
  if (cc.length !== 2) return [];

  // Overpass wants (south,west,north,east); the geocode result is ordered
  // [south, north, west, east].
  const bbox = boundingBox
    ? `${boundingBox[0]},${boundingBox[2]},${boundingBox[1]},${boundingBox[3]}`
    : null;

  const ql = bbox
    ? `[out:json][timeout:20];node["place"="city"]["population"](${bbox});out body 200;`
    : `[out:json][timeout:25];` +
      `area["ISO3166-1"="${cc}"]["admin_level"="2"]->.a;` +
      `node(area.a)["place"="city"]["population"];out body 80;`;

  await throttleHost('overpass-api.de', 1200);

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const json = await safeFetchJson<{
        elements?: Array<{ lat?: number; lon?: number; tags?: Record<string, string> }>;
      }>(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent(contactEmail),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(ql)}`,
        // Short on purpose: this runs while a user waits, and there is a better
        // hint (timezone, capital) that will usually have answered already.
        timeoutMs: 15_000,
      });

      const cities = (json.elements ?? [])
        .map((e) => ({
          name: e.tags?.['name:en'] ?? e.tags?.['name'] ?? '',
          latitude: e.lat ?? null,
          longitude: e.lon ?? null,
          // Population is free text in OSM ("1 400 000", "1,400,000").
          population: Number(String(e.tags?.['population'] ?? '').replace(/[^0-9]/g, '')) || 0,
        }))
        .filter(
          (c): c is MajorCity =>
            Boolean(c.name) && c.population > 0 && c.latitude !== null && c.longitude !== null,
        )
        .sort((a, b) => b.population - a.population);

      if (cities.length) {
        logger.info('found candidate cities for country', {
          countryCode: cc,
          count: cities.length,
          top: cities[0]?.name,
        });
      }
      return cities;
    } catch (error) {
      logger.warn('major-city lookup failed', { endpoint, error: (error as Error).message });
    }
  }
  return [];
}

interface NominatimSearchResult {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  type?: string;
  osm_type?: string;
  osm_id?: number;
  extratags?: Record<string, string>;
}

/**
 * Free-text business search via Nominatim, bounded to the search area.
 *
 * Used when a domain has no OpenStreetMap tag mapping. Nominatim is a
 * purpose-built text index, so it answers in well under a second where the
 * equivalent Overpass name-regex times out entirely.
 */
export async function searchByText(
  contactEmail: string,
  query: DiscoveryQuery,
  keywords: string[],
): Promise<BusinessCandidate[]> {
  const terms = [query.query, ...keywords].find((t) => t && t.trim());
  if (!terms) throw new DiscoveryError('invalid_request', 'Nothing to search for.');

  // A bounding box around the search centre, so results stay local.
  const radiusKm = Math.min(Math.max(query.radiusMeters, 500), 50_000) / 1000;
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.1, Math.cos((query.latitude * Math.PI) / 180)));
  const viewbox = [
    query.longitude - dLon,
    query.latitude + dLat,
    query.longitude + dLon,
    query.latitude - dLat,
  ].join(',');

  await throttleHost('nominatim.openstreetmap.org', 1100);

  const url =
    `${NOMINATIM}/search?format=jsonv2&limit=${Math.min(query.limit * 2, 40)}` +
    `&extratags=1&addressdetails=1&accept-language=en&bounded=1&viewbox=${encodeURIComponent(viewbox)}` +
    `&q=${encodeURIComponent(terms)}`;

  const places = await safeFetchJson<NominatimSearchResult[]>(url, {
    headers: { 'User-Agent': userAgent(contactEmail), Accept: 'application/json' },
  });

  const out: BusinessCandidate[] = [];
  for (const place of places) {
    const name = place.name?.trim() || place.display_name?.split(',')[0]?.trim();
    if (!name) continue;

    const tags = place.extratags ?? {};
    const rawPhone = tags['phone'] ?? tags['contact:phone'] ?? tags['contact:mobile'] ?? null;
    const normalized = normalizePhone(rawPhone, query.countryCode);
    const phoneE164 = normalized && !isBlockedNumber(normalized.e164) ? normalized.e164 : null;

    const osmType = place.osm_type ?? 'node';
    const sourceUrl = place.osm_id
      ? `https://www.openstreetmap.org/${osmType}/${place.osm_id}`
      : null;

    out.push({
      id: `osm_txt_${osmType}_${place.osm_id ?? name}`,
      name,
      category: place.type ?? null,
      address: place.display_name?.split(',').slice(1, 4).join(',').trim() || null,
      latitude: Number(place.lat),
      longitude: Number(place.lon),
      phoneE164,
      phoneRaw: rawPhone,
      website: tags['website'] ?? tags['contact:website'] ?? null,
      source: 'osm',
      sourceUrl,
      rating: null,
      reviewCount: null,
      distanceMeters: null,
      openingHours: tags['opening_hours']
        ? { raw: tags['opening_hours'], openNow: isOpenNow(tags['opening_hours']) }
        : null,
      phoneVerified: false,
      verificationSources: [
        {
          source: 'osm',
          sourceId: place.osm_id ? `${osmType}/${place.osm_id}` : null,
          sourceUrl,
          contributed: ['name', ...(phoneE164 ? ['phone'] : [])],
          retrievedAt: new Date().toISOString(),
        },
      ],
    });
  }

  logger.info('osm text search complete', {
    domain: query.domain,
    found: out.length,
    withPhone: out.filter((c) => c.phoneE164).length,
  });
  return out;
}

/**
 * Turns search phrases into single terms worth matching on a business name.
 *
 * "bakery croissant" as a literal name match finds nothing -- no shop is called
 * that. The individual words stand a chance, and stopwords are dropped so the
 * query does not match half the city.
 */
export function keywordTerms(keywords: string[]): string[] {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'for', 'near', 'in', 'at', 'best',
    'cheapest', 'good', 'shop', 'store', 'place', 'service', 'services',
  ]);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const phrase of keywords) {
    for (const word of String(phrase).toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length < 3 || stop.has(word) || seen.has(word)) continue;
      seen.add(word);
      out.push(word);
    }
  }
  return out;
}

/** Overpass regex/quoting metacharacters must not escape the query string. */
function escapeOverpass(value: string): string {
  return value.replace(/["\\]/g, '\\$&').slice(0, 80);
}

function toCandidate(element: OverpassElement, countryCode: string | null): BusinessCandidate | null {
  const tags = element.tags ?? {};
  const name = tags['name'] ?? tags['operator'] ?? tags['brand'];
  if (!name) return null; // An unnamed node is not something we can call about.

  const lat = element.lat ?? element.center?.lat ?? null;
  const lon = element.lon ?? element.center?.lon ?? null;

  const rawPhone =
    tags['phone'] ?? tags['contact:phone'] ?? tags['contact:mobile'] ?? tags['mobile'] ?? null;
  const normalized = normalizePhone(rawPhone, countryCode);
  // A premium-rate or fictional number is worse than none at all.
  const phoneE164 = normalized && !isBlockedNumber(normalized.e164) ? normalized.e164 : null;

  const sourceUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;
  const source: CandidateSourceRef = {
    source: 'osm',
    sourceId: `${element.type}/${element.id}`,
    sourceUrl,
    contributed: [
      'name',
      ...(phoneE164 ? ['phone'] : []),
      ...(tags['addr:street'] ? ['address'] : []),
    ],
    retrievedAt: new Date().toISOString(),
  };

  return {
    id: `osm_${element.type}_${element.id}`,
    name,
    category: tags['shop'] ?? tags['amenity'] ?? tags['craft'] ?? tags['healthcare'] ?? null,
    address: buildAddress(tags),
    latitude: lat,
    longitude: lon,
    phoneE164,
    phoneRaw: rawPhone,
    website: tags['website'] ?? tags['contact:website'] ?? null,
    source: 'osm',
    sourceUrl,
    // OSM carries no ratings. Leaving these null is honest; inventing a rating
    // to make ranking look richer would be fabricated data.
    rating: null,
    reviewCount: null,
    distanceMeters: null,
    openingHours: tags['opening_hours']
      ? { raw: tags['opening_hours'], openNow: isOpenNow(tags['opening_hours']) }
      : null,
    phoneVerified: false,
    verificationSources: [source],
  };
}

function buildAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:postcode'],
  ].filter((p) => p && p.trim());
  return parts.length ? parts.join(', ') : null;
}

/**
 * Evaluates the common subset of the OSM `opening_hours` syntax.
 *
 * Returns null -- explicitly "unknown" -- for anything it does not fully
 * understand, rather than guessing. A wrong `false` silently drops a business
 * that could have helped, and a wrong `true` wastes a call, so unknown is the
 * honest answer and the ranker treats it as neutral.
 */
export function isOpenNow(spec: string, now = new Date()): boolean | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (/24\/7/.test(trimmed)) return true;
  // Anything with rules we do not model: unknown rather than a guess.
  if (/PH|SH|easter|off|open|sunrise|sunset|week|\d{4}|;.*;.*;/i.test(trimmed)) return null;

  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const today = days[now.getDay()]!;
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const rule of trimmed.split(';')) {
    const match = /^\s*([A-Za-z,-]+)?\s*([0-9:,\s-]+)$/.exec(rule.trim());
    if (!match) continue;
    const dayPart = match[1];
    const timePart = match[2];
    if (!timePart) continue;

    if (dayPart && !dayMatches(dayPart, today, days)) continue;

    for (const span of timePart.split(',')) {
      const times = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(span);
      if (!times) continue;
      const start = Number(times[1]) * 60 + Number(times[2]);
      let end = Number(times[3]) * 60 + Number(times[4]);
      if (end <= start) end += 24 * 60; // spans midnight
      if (minutes >= start && minutes < end) return true;
    }
  }
  return false;
}

function dayMatches(dayPart: string, today: string, days: string[]): boolean {
  const todayIndex = days.indexOf(today);
  for (const token of dayPart.split(',')) {
    const range = /^([A-Za-z]{2})\s*-\s*([A-Za-z]{2})$/.exec(token.trim());
    if (range) {
      const from = days.indexOf(normalizeDay(range[1]!));
      const to = days.indexOf(normalizeDay(range[2]!));
      if (from === -1 || to === -1) continue;
      if (from <= to) {
        if (todayIndex >= from && todayIndex <= to) return true;
      } else if (todayIndex >= from || todayIndex <= to) {
        return true;
      }
      continue;
    }
    if (normalizeDay(token.trim()) === today) return true;
  }
  return false;
}

function normalizeDay(value: string): string {
  return value.slice(0, 2).charAt(0).toUpperCase() + value.slice(1, 2).toLowerCase();
}
