import { describe, it, expect, vi } from 'vitest';
import { FallbackGeocoder } from '../index.js';
import type { GeocodeResult, GeocodingProvider } from '../types.js';

/**
 * What happens when the preferred geocoder cannot answer.
 *
 * The case that forced this: a Google key was set before the APIs were enabled
 * on the project. Selecting the geocoder on "is a key present" alone made every
 * lookup throw, so no task could resolve a location -- a working app became a
 * broken one by adding a credential. The APIs are enabled separately from
 * issuing the key, so that state is the normal first run, not an edge case.
 */

function provider(name: string, behaviour: () => Promise<GeocodeResult | null>): GeocodingProvider {
  return {
    name,
    geocode: behaviour,
    reverse: behaviour,
  };
}

const DUBLIN: GeocodeResult = {
  latitude: 53.3498,
  longitude: -6.2603,
  label: 'Dublin, Ireland',
  countryCode: 'IE',
  addressType: 'city',
  spanKm: 20,
};

const CORK: GeocodeResult = { ...DUBLIN, label: 'Cork, Ireland' };

describe('FallbackGeocoder', () => {
  it('uses the primary when it answers, and does not touch the backup', async () => {
    const backup = vi.fn(async () => CORK);
    const geo = new FallbackGeocoder(
      provider('primary', async () => DUBLIN),
      provider('backup', backup),
    );

    expect((await geo.geocode('Dublin'))?.label).toBe('Dublin, Ireland');
    expect(backup).not.toHaveBeenCalled();
  });

  it('falls back when the primary throws', async () => {
    // A disabled API, a rejected key, an outage — all the same here.
    const geo = new FallbackGeocoder(
      provider('primary', async () => {
        throw new Error('Google geocoding returned REQUEST_DENIED.');
      }),
      provider('backup', async () => CORK),
    );

    expect((await geo.geocode('Cork'))?.label).toBe('Cork, Ireland');
  });

  it('falls back when the primary simply does not know the place', async () => {
    // Two datasets, not one: a place missing from one may be in the other.
    const geo = new FallbackGeocoder(
      provider('primary', async () => null),
      provider('backup', async () => CORK),
    );

    expect((await geo.geocode('somewhere obscure'))?.label).toBe('Cork, Ireland');
  });

  it('returns null when neither knows it, rather than inventing a place', async () => {
    const geo = new FallbackGeocoder(
      provider('primary', async () => null),
      provider('backup', async () => null),
    );

    expect(await geo.geocode('asdkjhaskdjh')).toBeNull();
  });

  it('lets a failure in the backup surface', async () => {
    // Nothing is left to try, so hiding it would turn an outage into "no such
    // place" — the pipeline treats those two very differently.
    const geo = new FallbackGeocoder(
      provider('primary', async () => {
        throw new Error('primary down');
      }),
      provider('backup', async () => {
        throw new Error('backup down');
      }),
    );

    await expect(geo.geocode('Dublin')).rejects.toThrow(/backup down/);
  });

  it('falls back for reverse geocoding too', async () => {
    const geo = new FallbackGeocoder(
      provider('primary', async () => {
        throw new Error('down');
      }),
      provider('backup', async () => CORK),
    );

    expect((await geo.reverse(51.89, -8.47))?.label).toBe('Cork, Ireland');
  });

  it('names both providers, so /health shows what is actually in use', async () => {
    const geo = new FallbackGeocoder(
      provider('google_geocoding', async () => DUBLIN),
      provider('nominatim', async () => CORK),
    );
    expect(geo.name).toBe('google_geocoding+nominatim');
  });
});
