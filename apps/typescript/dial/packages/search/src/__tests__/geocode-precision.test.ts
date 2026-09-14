import { describe, it, expect } from 'vitest';
import {
  isTooCoarseToSearch,
  isCountryLevel,
  cityFromTimezone,
  type GeocodeResult,
} from '../types.js';

/**
 * Written after a real failure: "Find the cheapest iPhone repair near me in
 * finland" geocoded to `addresstype: country` at 63.2467, 25.9209 — rural
 * central Finland — and a 10 km search there found nothing, reporting that
 * there were no repair shops in Finland.
 */

function geo(over: Partial<GeocodeResult> = {}): GeocodeResult {
  return {
    latitude: 60.16,
    longitude: 24.94,
    label: 'Helsinki, Finland',
    countryCode: 'FI',
    addressType: 'city',
    spanKm: 42,
    ...over,
  };
}

describe('isTooCoarseToSearch', () => {
  it('rejects a country — the case that caused the bug', () => {
    // The exact response Nominatim returns for "finland".
    expect(
      isTooCoarseToSearch(
        geo({ label: 'Suomi / Finland', addressType: 'country', spanKm: 1181 }),
      ),
    ).toBe(true);
  });

  it('rejects states and regions', () => {
    for (const addressType of ['state', 'region', 'province', 'territory', 'continent']) {
      expect(isTooCoarseToSearch(geo({ addressType, spanKm: 500 })), addressType).toBe(true);
    }
  });

  it('accepts a city, even a large one', () => {
    expect(isTooCoarseToSearch(geo({ addressType: 'city', spanKm: 42 }))).toBe(false);
    expect(isTooCoarseToSearch(geo({ label: 'Dubai', addressType: 'city', spanKm: 90 }))).toBe(false);
  });

  it('accepts a suburb, a road and a postcode', () => {
    for (const addressType of ['suburb', 'road', 'postcode', 'neighbourhood']) {
      expect(isTooCoarseToSearch(geo({ addressType, spanKm: 3 })), addressType).toBe(false);
    }
  });

  it('falls back to size when the type is unhelpful', () => {
    expect(isTooCoarseToSearch(geo({ addressType: null, spanKm: 800 }))).toBe(true);
    expect(isTooCoarseToSearch(geo({ addressType: null, spanKm: 12 }))).toBe(false);
  });

  it('does not flag a place whose size is unknown', () => {
    // Reverse geocoding starts from real coordinates; absence of a span is not
    // evidence of coarseness, and guessing would block valid searches.
    expect(isTooCoarseToSearch(geo({ addressType: 'unknown', spanKm: null }))).toBe(false);
    expect(isTooCoarseToSearch(geo({ addressType: undefined, spanKm: undefined }))).toBe(false);
  });

  it('treats the threshold as a boundary, not an approximation', () => {
    expect(isTooCoarseToSearch(geo({ addressType: 'county', spanKm: 200 }))).toBe(false);
    expect(isTooCoarseToSearch(geo({ addressType: 'county', spanKm: 201 }))).toBe(true);
  });
});

describe('cityFromTimezone', () => {
  it('reads the city an IANA zone is named after', () => {
    expect(cityFromTimezone('Asia/Riyadh')).toBe('Riyadh');
    expect(cityFromTimezone('Europe/Dublin')).toBe('Dublin');
    expect(cityFromTimezone('Asia/Tokyo')).toBe('Tokyo');
  });

  it('restores the spaces the zone format removes', () => {
    expect(cityFromTimezone('America/New_York')).toBe('New York');
    expect(cityFromTimezone('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });

  it('has nothing to offer when there is no zone', () => {
    // Finland and Morocco both come back without one, which is what the
    // Overpass fallback exists for.
    expect(cityFromTimezone(null)).toBeNull();
    expect(cityFromTimezone(undefined)).toBeNull();
    expect(cityFromTimezone('')).toBeNull();
  });

  it('rejects the zones that name no city', () => {
    expect(cityFromTimezone('UTC')).toBeNull();
    expect(cityFromTimezone('Etc/GMT+3')).toBeNull();
    expect(cityFromTimezone('Etc/Zulu')).toBeNull();
  });
});

describe('isCountryLevel', () => {
  it('accepts a city whose administrative area is enormous', () => {
    // Tokyo Metropolis spans 1,900 km because it administers the Ogasawara
    // Islands. The coordinate is still central Tokyo, so it is a fine place to
    // search — and rejecting it used to send the user back a question.
    const tokyo = geo({ label: 'Tokyo, Japan', addressType: 'province', spanKm: 1912 });
    expect(isCountryLevel(tokyo)).toBe(false);
    // The blunter check, correctly, still says it is too coarse to *start* from.
    expect(isTooCoarseToSearch(tokyo)).toBe(true);
  });

  it('rejects landing back on the country itself', () => {
    expect(isCountryLevel(geo({ addressType: 'country', spanKm: 1181 }))).toBe(true);
    expect(isCountryLevel(geo({ addressType: 'continent', spanKm: 8000 }))).toBe(true);
  });

  it('accepts ordinary cities and towns', () => {
    for (const addressType of ['city', 'town', 'village', 'suburb', 'administrative']) {
      expect(isCountryLevel(geo({ addressType })), addressType).toBe(false);
    }
  });
});
