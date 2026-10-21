import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleGeocoder } from '../google-places.js';
import { isTooCoarseToSearch, cityFromTimezone } from '../types.js';

/**
 * Google as a drop-in for OpenStreetMap.
 *
 * The seam only holds if both providers answer the same questions. Google's
 * geocoder returns different words for the same ideas -- `locality` rather than
 * `city`, `administrative_area_level_1` rather than `state` -- and publishes
 * the extent of a place as a viewport rather than a bounding box.
 *
 * Getting that translation wrong does not fail loudly. `isTooCoarseToSearch`
 * simply stops recognising a country, Dial searches 10 km around its centroid,
 * and reports truthfully that there are no businesses in Finland.
 */

const KEY = 'test-key';

function mockFetch(payloads: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    const match = Object.keys(payloads).find((k) => url.includes(k));
    const body = match ? payloads[match] : { status: 'ZERO_RESULTS' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Shaped like a real Google Geocoding response. */
function geocodePayload(over: Record<string, unknown> = {}) {
  return {
    status: 'OK',
    results: [
      {
        formatted_address: 'Helsinki, Finland',
        types: ['locality', 'political'],
        geometry: {
          location: { lat: 60.1699, lng: 24.9384 },
          bounds: {
            northeast: { lat: 60.2978, lng: 25.2545 },
            southwest: { lat: 60.1183, lng: 24.7828 },
          },
        },
        address_components: [{ short_name: 'FI', long_name: 'Finland', types: ['country'] }],
        ...over,
      },
    ],
  };
}

describe('GoogleGeocoder', () => {
  it('translates a city so the rest of Dial recognises it', async () => {
    mockFetch({ '/geocode/json': geocodePayload() });
    const geo = await new GoogleGeocoder(KEY).geocode('Helsinki');

    expect(geo).not.toBeNull();
    expect(geo!.addressType).toBe('city');
    expect(geo!.countryCode).toBe('FI');
    // ~20 km across, so a local search around it is meaningful.
    expect(geo!.spanKm).toBeLessThan(50);
    expect(isTooCoarseToSearch(geo!)).toBe(false);
  });

  it('translates a country so it is still rejected as a search centre', async () => {
    // The exact shape that caused "no iPhone repair shops in Finland".
    mockFetch({
      '/geocode/json': geocodePayload({
        formatted_address: 'Finland',
        types: ['country', 'political'],
        geometry: {
          location: { lat: 61.9241, lng: 25.7482 },
          bounds: {
            northeast: { lat: 70.0922, lng: 31.5867 },
            southwest: { lat: 59.4541, lng: 19.0832 },
          },
        },
      }),
      '/timezone/json': { status: 'OK', timeZoneId: 'Europe/Helsinki' },
    });

    const geo = await new GoogleGeocoder(KEY).geocode('Finland');
    expect(geo!.addressType).toBe('country');
    expect(geo!.spanKm).toBeGreaterThan(1000);
    expect(isTooCoarseToSearch(geo!)).toBe(true);
  });

  it('maps a region to a word the coarseness check understands', async () => {
    mockFetch({
      '/geocode/json': geocodePayload({
        formatted_address: 'California, USA',
        types: ['administrative_area_level_1', 'political'],
      }),
      '/timezone/json': { status: 'OK', timeZoneId: 'America/Los_Angeles' },
    });
    const geo = await new GoogleGeocoder(KEY).geocode('California');
    // Not Google's raw 'administrative_area_level_1', which means nothing here.
    expect(geo!.addressType).toBe('state');
    expect(isTooCoarseToSearch(geo!)).toBe(true);
  });

  it('supplies the timezone for a country, so it resolves to a real city', async () => {
    // Google does not carry a timezone on the geocode, and without one a
    // country has no searchable city to fall back to.
    mockFetch({
      '/geocode/json': geocodePayload({
        formatted_address: 'Saudi Arabia',
        types: ['country', 'political'],
        geometry: {
          location: { lat: 23.8859, lng: 45.0792 },
          bounds: {
            northeast: { lat: 32.1543, lng: 55.6667 },
            southwest: { lat: 16.29, lng: 34.4572 },
          },
        },
      }),
      '/timezone/json': { status: 'OK', timeZoneId: 'Asia/Riyadh' },
    });

    const geo = await new GoogleGeocoder(KEY).geocode('Saudi Arabia');
    expect(geo!.timezone).toBe('Asia/Riyadh');
    expect(cityFromTimezone(geo!.timezone)).toBe('Riyadh');
  });

  it('does not spend a request on a timezone it will not use', async () => {
    const fetchSpy = mockFetch({ '/geocode/json': geocodePayload() });
    await new GoogleGeocoder(KEY).geocode('Helsinki');

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/timezone/json'))).toBe(false);
  });

  it('reports the bounding box in Dial’s order, not Google’s', async () => {
    mockFetch({ '/geocode/json': geocodePayload() });
    const geo = await new GoogleGeocoder(KEY).geocode('Helsinki');
    // [south, north, west, east] — getting this order wrong silently searches
    // the wrong rectangle when resolving a country to its largest city.
    expect(geo!.boundingBox).toEqual([60.1183, 60.2978, 24.7828, 25.2545]);
  });

  it('treats no match as no match, not as a failure', async () => {
    mockFetch({ '/geocode/json': { status: 'ZERO_RESULTS' } });
    await expect(new GoogleGeocoder(KEY).geocode('asdkjhaskdjh')).resolves.toBeNull();
  });

  it('raises a rejected key rather than passing it off as an empty area', async () => {
    // REQUEST_DENIED means the key or the enabled APIs are wrong. Returning
    // null here would present a configuration fault as "nothing found there".
    mockFetch({
      '/geocode/json': { status: 'REQUEST_DENIED', error_message: 'API key not valid' },
    });
    await expect(new GoogleGeocoder(KEY).geocode('Helsinki')).rejects.toThrow(/REQUEST_DENIED/);
  });

  it('survives a timezone lookup that fails', async () => {
    // The zone is an optimisation. Losing it costs a fallback, not the task.
    mockFetch({
      '/geocode/json': geocodePayload({
        formatted_address: 'Finland',
        types: ['country', 'political'],
      }),
      '/timezone/json': { status: 'REQUEST_DENIED' },
    });
    const geo = await new GoogleGeocoder(KEY).geocode('Finland');
    expect(geo).not.toBeNull();
    expect(geo!.timezone).toBeNull();
  });

  it('does nothing at all without a key', async () => {
    const fetchSpy = mockFetch({});
    expect(await new GoogleGeocoder('').geocode('Helsinki')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
