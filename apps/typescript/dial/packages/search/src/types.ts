import type { BusinessCandidate } from '@dial/schemas';

/**
 * Section 7. Provider-independent research interfaces. Everything above this
 * seam works in terms of BusinessCandidate; swapping OpenStreetMap for Google
 * Places is a configuration change, not a rewrite.
 */

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  label: string;
  /** ISO 3166-1 alpha-2, used as the default region for phone normalisation. */
  countryCode: string | null;
  /**
   * What kind of place matched: 'country', 'state', 'city', 'suburb', 'road'...
   * Provider-specific, so treat it as a hint and lean on `spanKm`.
   */
  addressType?: string | null;
  /**
   * Roughly how wide the matched place is, in kilometres.
   *
   * This matters because a coordinate alone hides the difference between
   * "Helsinki" and "Finland". Both give you a lat/lon; only one of them is a
   * sensible centre for a 10 km search. Geocoding a country and then searching
   * near its centroid lands in empty countryside and reports, truthfully but
   * uselessly, that there are no businesses.
   */
  spanKm?: number | null;
  /**
   * IANA timezone from the provider, e.g. 'Asia/Riyadh'.
   *
   * Useful beyond time: IANA names zones after a major city in the region, so
   * for a country-level match this gives somewhere searchable without needing
   * a hardcoded list of capitals or a second service.
   */
  timezone?: string | null;
  /**
   * The country's capital, when the provider knows it (OSM tags this on the
   * country relation as `capital_city`). The most direct answer to "somewhere
   * searchable in this country" when it is present.
   */
  capitalCity?: string | null;
  /**
   * [south, north, west, east] in degrees, as the provider reported it.
   *
   * Kept alongside `spanKm` because the two answer different questions: the
   * span says how big the place is, the box says where it is. Searching a
   * country for its largest city needs the box, and having it here avoids
   * geocoding the same country twice.
   */
  boundingBox?: [number, number, number, number] | null;
}

/**
 * Is this place too large for a local search to mean anything?
 *
 * Countries and states always are. Anything wider than ~200 km is too, which
 * catches large administrative regions without flagging genuinely big cities.
 */
/**
 * The city an IANA timezone is named after, e.g. 'Asia/Riyadh' -> 'Riyadh'.
 *
 * Not always the largest city in the country (`America/New_York` for the US),
 * but always a major one — which is all that is needed to turn "somewhere in
 * this country" into somewhere Dial can actually search.
 */
export function cityFromTimezone(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  const last = timezone.split('/').pop();
  if (!last) return null;
  // Zone names use underscores for spaces, and a few are not cities at all.
  const name = last.replace(/_/g, ' ').trim();
  if (!name || /^(GMT|UTC|Universal|Zulu)/i.test(name)) return null;
  return name;
}

/**
 * Is this match the country (or larger) itself, rather than somewhere inside it?
 *
 * Deliberately looser than `isTooCoarseToSearch`, and used for a different
 * question. When a country has been resolved to a named city, the coordinate
 * comes from that city's own place node -- central Tokyo, not the middle of the
 * Pacific -- so how wide the surrounding administrative area happens to be does
 * not matter. Tokyo Metropolis spans 1,900 km because it administers the
 * Ogasawara Islands, and is still exactly where you would want to search. All
 * that must be rejected here is landing back on the country itself.
 */
export function isCountryLevel(geo: GeocodeResult): boolean {
  return ['country', 'continent'].includes((geo.addressType ?? '').toLowerCase());
}

export function isTooCoarseToSearch(geo: GeocodeResult): boolean {
  const type = (geo.addressType ?? '').toLowerCase();
  if (['country', 'state', 'region', 'province', 'territory', 'continent'].includes(type)) {
    return true;
  }
  return typeof geo.spanKm === 'number' && geo.spanKm > 200;
}

export interface GeocodingProvider {
  readonly name: string;
  /** Free text -> coordinates. */
  geocode(query: string): Promise<GeocodeResult | null>;
  /** Coordinates -> a human label, for showing the user where Dial searched. */
  reverse(latitude: number, longitude: number): Promise<GeocodeResult | null>;
}

export interface DiscoveryQuery {
  /** What to look for, e.g. "phone repair shop". */
  query: string;
  /** Normalised domain key, e.g. "phone_repair". Drives category mapping. */
  domain: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit: number;
  /** Region hint for phone normalisation, e.g. "IE". */
  countryCode: string | null;
  openNow?: boolean;
}

export interface BusinessDiscoveryProvider {
  readonly name: string;
  /** True when the provider has what it needs (key, contact email) to run. */
  isConfigured(): boolean;
  discover(query: DiscoveryQuery): Promise<BusinessCandidate[]>;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  readonly name: string;
  isConfigured(): boolean;
  search(query: string, limit: number): Promise<WebSearchResult[]>;
}

export interface BusinessContactVerifier {
  readonly name: string;
  /**
   * Attempts to corroborate a candidate's phone number from a second source.
   * Returns the candidate unchanged when it cannot; it never invents a number.
   */
  verify(candidate: BusinessCandidate): Promise<BusinessCandidate>;
}

export class DiscoveryError extends Error {
  constructor(
    readonly code:
      | 'provider_unavailable'
      | 'rate_limited'
      | 'not_configured'
      | 'invalid_request'
      | 'network_error',
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'DiscoveryError';
  }
}
