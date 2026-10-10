import type { BusinessCandidate } from '@dial/schemas';
import { dedupeCandidates, withDistances } from '@dial/domain';
import { config, type DialConfig } from '@dial/config';
import { logger, timed, incrementCounter } from '@dial/observability';
import {
  NominatimGeocoder,
  OverpassDiscoveryProvider,
  findMajorCities,
  type MajorCity,
} from './osm.js';
import { GooglePlacesProvider, GoogleGeocoder } from './google-places.js';
import {
  DiscoveryError,
  type BusinessDiscoveryProvider,
  type DiscoveryQuery,
  type GeocodeResult,
  type GeocodingProvider,
} from './types.js';

export * from './types.js';
export * from './categories.js';
export {
  NominatimGeocoder,
  OverpassDiscoveryProvider,
  isOpenNow,
  keywordTerms,
  findMajorCities,
  type MajorCity,
} from './osm.js';
export { GooglePlacesProvider, GoogleGeocoder } from './google-places.js';
export { assertAllowedUrl, safeFetch, safeFetchJson } from './http.js';

export interface DiscoveryOutcome {
  candidates: BusinessCandidate[];
  /** Which providers actually contributed, for the evidence trail. */
  providersUsed: string[];
  /** Providers that failed, so the UI can say search was degraded, not empty. */
  providerErrors: Array<{ provider: string; code: string; message: string; retryable: boolean }>;
}

/**
 * How far down the population ranking to look for a city that is actually in
 * the requested country. Each check costs a reverse geocode, and a country
 * whose four biggest nearby cities are all foreign is not one this shortcut can
 * help with.
 */
const MAX_CITY_VERIFICATIONS = 4;

/**
 * Google first, OpenStreetMap behind it.
 *
 * Selecting a geocoder purely on "is a key present" makes a key that does not
 * yet work worse than no key at all: every lookup throws, no task can resolve a
 * location, and the app is more broken than before the key was added. That is
 * not a hypothetical -- the Places, Geocoding and Time Zone APIs are enabled
 * separately on a Google Cloud project, and a fresh key has none of them on.
 *
 * So in `auto` mode a failure is not fatal, it is a fallback. `google` mode
 * gets no fallback, because asking for one provider and silently being served
 * another is exactly the kind of quiet substitution Dial must not do.
 */
export class FallbackGeocoder implements GeocodingProvider {
  readonly name: string;

  constructor(
    private readonly primary: GeocodingProvider,
    private readonly backup: GeocodingProvider,
  ) {
    this.name = `${primary.name}+${backup.name}`;
  }

  async geocode(query: string): Promise<GeocodeResult | null> {
    return this.attempt('geocode', (p) => p.geocode(query));
  }

  async reverse(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    return this.attempt('reverse', (p) => p.reverse(latitude, longitude));
  }

  private async attempt(
    operation: string,
    run: (provider: GeocodingProvider) => Promise<GeocodeResult | null>,
  ): Promise<GeocodeResult | null> {
    try {
      const result = await run(this.primary);
      if (result) return result;
      // Not an error: the primary simply does not know this place. The backup
      // is a different dataset and may.
      logger.info('primary geocoder found nothing, trying the backup', {
        operation,
        primary: this.primary.name,
      });
    } catch (error) {
      logger.warn('primary geocoder failed, falling back', {
        operation,
        primary: this.primary.name,
        error: (error as Error).message,
      });
      incrementCounter('search.geocoder_fallback', { primary: this.primary.name });
    }
    return run(this.backup);
  }
}

export class DiscoveryService {
  private readonly providers: BusinessDiscoveryProvider[];
  private readonly geocoder: GeocodingProvider;
  private readonly osmContactEmail: string;

  constructor(cfg: DialConfig = config()) {
    this.osmContactEmail = cfg.discovery.osmContactEmail;
    const google = new GooglePlacesProvider(cfg.discovery.googlePlacesApiKey);
    const osm = new OverpassDiscoveryProvider(cfg.discovery.osmContactEmail);

    // Google first when configured: it carries ratings and verified numbers.
    // OSM always participates, so a second independent source can corroborate a
    // phone number -- which is what lets us mark one `phoneVerified`.
    const preference = cfg.discovery.preference;
    if (preference === 'google') {
      // Falling back without a word would look like Google was in use while
      // every result actually came from OpenStreetMap.
      if (!google.isConfigured()) {
        logger.warn('DISCOVERY_PROVIDER is google but GOOGLE_PLACES_API_KEY is unset', {
          usingInstead: osm.name,
        });
      }
      this.providers = google.isConfigured() ? [google] : [osm];
    }
    else if (preference === 'osm') this.providers = [osm];
    else this.providers = google.isConfigured() ? [google, osm] : [osm];

    const nominatim = new NominatimGeocoder(cfg.discovery.osmContactEmail);
    if (!cfg.discovery.googlePlacesApiKey) {
      this.geocoder = nominatim;
    } else if (preference === 'google') {
      // Asked for Google alone, so a Google failure is a failure.
      this.geocoder = new GoogleGeocoder(cfg.discovery.googlePlacesApiKey);
    } else {
      this.geocoder = new FallbackGeocoder(
        new GoogleGeocoder(cfg.discovery.googlePlacesApiKey),
        nominatim,
      );
    }
  }

  /** Names of the providers that will be consulted, for /health. */
  describe(): string {
    return `${this.providers.map((p) => p.name).join('+')} / ${this.geocoder.name}`;
  }

  async geocode(query: string): Promise<GeocodeResult | null> {
    return timed('search.geocode', { provider: this.geocoder.name }, () =>
      this.geocoder.geocode(query),
    );
  }

  /**
   * The largest city in a country, so a country-level request can be searched
   * rather than refused. Null when it cannot be determined.
   *
   * The ranked list comes back from a bounding-box search, which does not stop
   * at the border, so each candidate is checked against the country it is
   * supposed to be in before being accepted -- otherwise "Finland" resolves to
   * Saint Petersburg, which is both the largest city in the box and in the
   * wrong country. Reverse geocoding the city's own coordinate answers that
   * exactly, and only the first few are worth the calls.
   */
  async findMajorCity(
    countryCode: string | null,
    boundingBox: [number, number, number, number] | null = null,
  ): Promise<MajorCity | null> {
    if (!countryCode) return null;
    const ranked = await findMajorCities(this.osmContactEmail, countryCode, boundingBox);
    if (!ranked.length) return null;
    // Without a box the query was already restricted to the country's area, so
    // the top result needs no second opinion.
    if (!boundingBox) return ranked[0] ?? null;

    for (const city of ranked.slice(0, MAX_CITY_VERIFICATIONS)) {
      const where = await this.reverseGeocode(city.latitude, city.longitude).catch(() => null);
      if (where?.countryCode === countryCode.toUpperCase()) return city;
      logger.info('skipped a city outside the requested country', {
        city: city.name,
        expected: countryCode,
        actual: where?.countryCode ?? 'unknown',
      });
    }
    return null;
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
    return timed('search.reverse_geocode', { provider: this.geocoder.name }, () =>
      this.geocoder.reverse(latitude, longitude),
    );
  }

  /**
   * Runs every configured provider, merges the results, and reports failures
   * rather than swallowing them: a task that found nothing because the provider
   * was down is a different user-facing story from one where no business exists.
   */
  async discover(query: DiscoveryQuery): Promise<DiscoveryOutcome> {
    const collected: BusinessCandidate[] = [];
    const providersUsed: string[] = [];
    const providerErrors: DiscoveryOutcome['providerErrors'] = [];

    for (const provider of this.providers) {
      if (!provider.isConfigured()) continue;
      try {
        const found = await timed('search.discover', { provider: provider.name }, () =>
          provider.discover(query),
        );
        if (found.length) providersUsed.push(provider.name);
        collected.push(...found);
      } catch (error) {
        const code = error instanceof DiscoveryError ? error.code : 'provider_unavailable';
        const message = (error as Error).message;
        // A timeout or a rate limit is worth trying again; a malformed query is
        // not, and retrying it just wastes the directory's time and ours.
        const retryable = error instanceof DiscoveryError ? error.retryable : true;
        providerErrors.push({ provider: provider.name, code, message, retryable });
        incrementCounter('search.provider_error', { provider: provider.name, code });
        logger.warn('discovery provider failed', { provider: provider.name, code, error: message });
      }
    }

    const withDistance = withDistances(collected, {
      latitude: query.latitude,
      longitude: query.longitude,
    });
    const merged = dedupeCandidates(withDistance);

    logger.info('discovery merged', {
      raw: collected.length,
      merged: merged.length,
      callable: merged.filter((c) => c.phoneE164).length,
      providersUsed,
    });

    return { candidates: merged, providersUsed, providerErrors };
  }
}
