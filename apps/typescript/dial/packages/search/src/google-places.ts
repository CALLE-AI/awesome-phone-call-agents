import type { BusinessCandidate, CandidateSourceRef } from '@dial/schemas';
import { normalizePhone, isBlockedNumber } from '@dial/domain';
import { logger } from '@dial/observability';
import { safeFetchJson } from './http.js';
import { resolveDomainMapping } from './categories.js';
import {
  DiscoveryError,
  isTooCoarseToSearch,
  type BusinessDiscoveryProvider,
  type DiscoveryQuery,
  type GeocodeResult,
  type GeocodingProvider,
} from './types.js';

/**
 * Google Places (New) adapter. Inactive until GOOGLE_PLACES_API_KEY is set, at
 * which point the resolver prefers it -- it carries ratings, review counts and
 * verified phone numbers that OpenStreetMap does not.
 *
 * Written against the v1 REST surface (places:searchText). The API key is read
 * from server config only and travels in a header, never a query string.
 */

const PLACES_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.primaryType',
  'places.currentOpeningHours.openNow',
  'places.regularOpeningHours.weekdayDescriptions',
].join(',');

interface PlacesResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    rating?: number;
    userRatingCount?: number;
    websiteUri?: string;
    primaryType?: string;
    currentOpeningHours?: { openNow?: boolean };
    regularOpeningHours?: { weekdayDescriptions?: string[] };
  }>;
}

/**
 * Turns Google's rejection of a key into something an operator can act on.
 *
 * On a fresh key the overwhelmingly likely failure is that the Places API has
 * not been enabled on the project, or that billing has not been set up. Both
 * come back as a 403, which the generic handling reports as "Dial could not
 * reach the business directory" -- true, unhelpful, and indistinguishable from
 * an outage. Naming the real cause is the difference between a two-minute fix
 * and an afternoon.
 */
function asConfigurationError(error: unknown): unknown {
  if (!(error instanceof DiscoveryError)) return error;
  const message = error.message;

  if (/\b403\b|PERMISSION_DENIED|SERVICE_DISABLED/i.test(message)) {
    return new DiscoveryError(
      'not_configured',
      'Google rejected the request (403). Enable the Places API (New) on the project ' +
        'and make sure billing is active, then check any key restrictions.',
    );
  }
  if (/\b400\b/i.test(message) && /API_KEY_INVALID|API key not valid/i.test(message)) {
    return new DiscoveryError('not_configured', 'GOOGLE_PLACES_API_KEY is not a valid API key.');
  }
  if (/\b401\b/i.test(message)) {
    return new DiscoveryError('not_configured', 'Google rejected the API key.');
  }
  return error;
}

export class GooglePlacesProvider implements BusinessDiscoveryProvider {
  readonly name = 'google_places';

  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async discover(query: DiscoveryQuery): Promise<BusinessCandidate[]> {
    if (!this.isConfigured()) {
      throw new DiscoveryError('not_configured', 'GOOGLE_PLACES_API_KEY is not set.');
    }
    const mapping = resolveDomainMapping(query.domain, query.query);

    const body: Record<string, unknown> = {
      textQuery: query.query || mapping.keywords[0] || query.domain,
      maxResultCount: Math.min(query.limit * 2, 20),
      locationBias: {
        circle: {
          center: { latitude: query.latitude, longitude: query.longitude },
          radius: Math.min(Math.max(query.radiusMeters, 500), 50_000),
        },
      },
    };
    if (query.openNow) body['openNow'] = true;
    if (mapping.googleTypes[0]) body['includedType'] = mapping.googleTypes[0];

    let response: PlacesResponse;
    try {
      response = await safeFetchJson<PlacesResponse>(PLACES_SEARCH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw asConfigurationError(error);
    }

    const candidates: BusinessCandidate[] = [];
    for (const place of response.places ?? []) {
      const name = place.displayName?.text;
      if (!name) continue;

      const raw = place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null;
      const normalized = normalizePhone(raw, query.countryCode);
      const phoneE164 = normalized && !isBlockedNumber(normalized.e164) ? normalized.e164 : null;

      const sourceUrl = `https://www.google.com/maps/place/?q=place_id:${place.id}`;
      const source: CandidateSourceRef = {
        source: 'google_places',
        sourceId: place.id,
        sourceUrl,
        contributed: ['name', ...(phoneE164 ? ['phone'] : []), 'address', 'rating'],
        retrievedAt: new Date().toISOString(),
      };

      candidates.push({
        id: `gp_${place.id}`,
        name,
        category: place.primaryType ?? null,
        address: place.formattedAddress ?? null,
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
        phoneE164,
        phoneRaw: raw,
        website: place.websiteUri ?? null,
        source: 'google_places',
        sourceUrl,
        rating: place.rating ?? null,
        reviewCount: place.userRatingCount ?? null,
        distanceMeters: null,
        openingHours:
          place.currentOpeningHours?.openNow !== undefined ||
          place.regularOpeningHours?.weekdayDescriptions
            ? {
                raw: place.regularOpeningHours?.weekdayDescriptions?.join('; ') ?? null,
                openNow: place.currentOpeningHours?.openNow ?? null,
              }
            : null,
        phoneVerified: false,
        verificationSources: [source],
      });
    }

    logger.info('google places discovery complete', {
      domain: query.domain,
      found: candidates.length,
      withPhone: candidates.filter((c) => c.phoneE164).length,
    });
    return candidates;
  }
}

const TIMEZONE = 'https://maps.googleapis.com/maps/api/timezone/json';

/**
 * Google's place types, translated into the vocabulary the rest of Dial uses.
 *
 * This matters more than it looks. `isTooCoarseToSearch` decides whether a
 * match is a sensible centre for a local search by reading `addressType`, and
 * it knows words like 'country' and 'state'. Handed Google's raw
 * `administrative_area_level_1` it recognises nothing, treats a whole region as
 * searchable, and searches 10 km around its centroid -- which is how "no iPhone
 * repair shops in Finland" happened with the other provider.
 */
function mapGoogleType(types: string[] | undefined): string | null {
  if (!types?.length) return null;
  for (const type of types) {
    switch (type) {
      case 'country':
        return 'country';
      case 'administrative_area_level_1':
        return 'state';
      case 'administrative_area_level_2':
        return 'region';
      case 'locality':
      case 'postal_town':
        return 'city';
      case 'sublocality':
      case 'sublocality_level_1':
        return 'suburb';
      case 'neighborhood':
        return 'neighbourhood';
      case 'postal_code':
        return 'postcode';
      case 'route':
        return 'road';
      case 'street_address':
      case 'premise':
        return 'address';
      default:
        continue;
    }
  }
  return types[0] ?? null;
}

interface GoogleViewport {
  northeast: { lat: number; lng: number };
  southwest: { lat: number; lng: number };
}

/** Widest dimension of a Google viewport, in kilometres. */
function spanKmOf(viewport: GoogleViewport | undefined): number | null {
  if (!viewport) return null;
  const { northeast: ne, southwest: sw } = viewport;
  if (![ne?.lat, ne?.lng, sw?.lat, sw?.lng].every((n) => Number.isFinite(n))) return null;
  const latKm = (ne.lat - sw.lat) * 111;
  const lonKm = (ne.lng - sw.lng) * 111 * Math.cos((sw.lat * Math.PI) / 180);
  return Math.round(Math.max(latKm, Math.abs(lonKm)));
}

/** Google's viewport, as the [south, north, west, east] the rest of Dial uses. */
function boundingBoxOf(
  viewport: GoogleViewport | undefined,
): [number, number, number, number] | null {
  if (!viewport) return null;
  const { northeast: ne, southwest: sw } = viewport;
  if (![ne?.lat, ne?.lng, sw?.lat, sw?.lng].every((n) => Number.isFinite(n))) return null;
  return [sw.lat, ne.lat, sw.lng, ne.lng];
}

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address: string;
    types?: string[];
    geometry: {
      location: { lat: number; lng: number };
      viewport?: GoogleViewport;
      bounds?: GoogleViewport;
    };
    address_components?: Array<{ short_name: string; long_name: string; types: string[] }>;
  }>;
}

export class GoogleGeocoder implements GeocodingProvider {
  readonly name = 'google_geocoding';

  constructor(private readonly apiKey: string) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    if (!this.apiKey || !query.trim()) return null;
    const url =
      `${GEOCODE}?address=${encodeURIComponent(query)}` +
      `&language=en&key=${encodeURIComponent(this.apiKey)}`;
    return this.request(url);
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    if (!this.apiKey) return null;
    const url =
      `${GEOCODE}?latlng=${latitude},${longitude}` +
      `&language=en&key=${encodeURIComponent(this.apiKey)}`;
    return this.request(url);
  }

  /**
   * The IANA zone for a coordinate, e.g. 'Asia/Riyadh'.
   *
   * Fetched only for country-sized matches, and only because zones are named
   * after a major city -- which is what turns "somewhere in Saudi Arabia" into
   * somewhere searchable without a hardcoded list of capitals. Google returns
   * this from a separate endpoint rather than on the geocode, so it costs a
   * request; asking for every geocode would be one per task for no benefit.
   */
  private async timezoneFor(latitude: number, longitude: number): Promise<string | null> {
    const url =
      `${TIMEZONE}?location=${latitude},${longitude}` +
      `&timestamp=${Math.floor(Date.now() / 1000)}&key=${encodeURIComponent(this.apiKey)}`;
    try {
      const data = await safeFetchJson<{ status: string; timeZoneId?: string }>(url, {
        timeoutMs: 5_000,
      });
      return data.status === 'OK' ? (data.timeZoneId ?? null) : null;
    } catch (error) {
      // A missing zone costs a fallback, not the task.
      logger.warn('google timezone lookup failed', { error: (error as Error).message });
      return null;
    }
  }

  private async request(url: string): Promise<GeocodeResult | null> {
    const data = await safeFetchJson<GoogleGeocodeResponse>(url);

    // ZERO_RESULTS is a real answer -- nothing matched. The rest are faults
    // worth surfacing, because a bad key or an unenabled API otherwise looks
    // exactly like "that place does not exist".
    if (data.status === 'ZERO_RESULTS') return null;
    if (data.status !== 'OK') {
      logger.warn('google geocoding rejected the request', {
        status: data.status,
        message: data.error_message ?? null,
      });
      const retryable = data.status === 'OVER_QUERY_LIMIT' || data.status === 'UNKNOWN_ERROR';
      throw new DiscoveryError(
        data.status === 'REQUEST_DENIED' ? 'not_configured' : 'provider_unavailable',
        `Google geocoding returned ${data.status}.`,
        retryable,
      );
    }
    if (!data.results?.length) return null;

    const first = data.results[0]!;
    const country = first.address_components?.find((c) => c.types.includes('country'));
    // `bounds` is the real extent where Google publishes it; `viewport` is a
    // display rectangle and can be padded. Prefer the former.
    const box = first.geometry.bounds ?? first.geometry.viewport;

    const result: GeocodeResult = {
      latitude: first.geometry.location.lat,
      longitude: first.geometry.location.lng,
      label: first.formatted_address,
      countryCode: country?.short_name ?? null,
      addressType: mapGoogleType(first.types),
      spanKm: spanKmOf(box),
      boundingBox: boundingBoxOf(box),
      // Google's geocoder does not carry either of these.
      timezone: null,
      capitalCity: null,
    };

    if (isTooCoarseToSearch(result)) {
      result.timezone = await this.timezoneFor(result.latitude, result.longitude);
    }
    return result;
  }
}
