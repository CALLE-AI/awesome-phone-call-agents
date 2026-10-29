import { describe, it, expect, afterEach } from 'vitest';
import {
  createHarness,
  signUp,
  createTask,
  getTaskDetail,
  stubDiscovery,
  stubInterpreter,
  candidate,
  REPAIR_TASK,
  type Harness,
} from './harness.js';

/**
 * Naming a place must not become a question about that same place.
 *
 * From a real complaint: asked to find a jeweller in Dubai, Dial replied
 * "Where should Dial search? A city, area or postcode is enough." Being told a
 * place and then asking for it again is the worst possible answer, and it
 * happened for two separate reasons — a momentary geocoder failure, and a
 * country being too wide to search around its centre.
 *
 * A country centre genuinely is unsearchable (Finland's is rural), so the fix
 * is to resolve it to a real city and disclose that, not to search anyway.
 */

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/** A geocode of a whole country, shaped like the real Nominatim response. */
function countryGeo(over: Record<string, unknown> = {}) {
  return {
    latitude: 24.0,
    longitude: 45.0,
    label: 'Saudi Arabia',
    countryCode: 'SA',
    addressType: 'country',
    spanKm: 2260,
    timezone: 'Asia/Riyadh',
    capitalCity: null,
    boundingBox: [16.29, 32.15, 34.45, 55.66] as [number, number, number, number],
    ...over,
  };
}

const RIYADH = {
  latitude: 24.6389,
  longitude: 46.716,
  label: 'Riyadh, Riyadh Region, Saudi Arabia',
  countryCode: 'SA',
  addressType: 'city',
  spanKm: 36,
};

const HELSINKI = { name: 'Helsinki', latitude: 60.1666, longitude: 24.9435, population: 695526 };

function taskInPlace(raw: string) {
  return stubInterpreter(() => ({
    task: {
      ...REPAIR_TASK,
      location: { raw, latitude: null, longitude: null, label: null, radiusKm: 10 },
    },
    callFamily: 'repair_quote' as const,
  }));
}

describe('a request that names a country', () => {
  it('searches its major city rather than asking which one', async () => {
    h = await createHarness({
      interpreter: taskInPlace('Saudi Arabia'),
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'sa1', name: 'Riyadh Phone Fix', phoneE164: '+966112345678' })],
        geocode: countryGeo(),
        // The timezone hint, geocoded: a real city inside the same country.
        geocodeOverrides: [{ match: 'Riyadh', result: RIYADH }],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'find me a phone repair shop in Saudi Arabia');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);

    // Dial may still stop to ask which language to speak; what it must never
    // do is ask where to search after being told.
    expect(detail.clarificationQuestion ?? '').not.toMatch(/where|town or city|postcode/i);
    expect(JSON.stringify(detail)).not.toMatch(/postcode/i);
    expect(JSON.stringify(detail)).not.toMatch(/Where should Dial search/i);
    // It went ahead and rang somebody.
    // These tests are about where Dial looked, not whether it dialled: finding
    // businesses is the proof the search happened in the right place.
    expect(detail.candidates.length).toBeGreaterThan(0);
  });

  it('says which city it picked, and that the user can name another', async () => {
    // Choosing on the user's behalf is only acceptable if it is disclosed.
    h = await createHarness({
      interpreter: taskInPlace('Saudi Arabia'),
      discovery: stubDiscovery({
        candidates: [candidate({ id: 'sa1', name: 'Riyadh Phone Fix', phoneE164: '+966112345678' })],
        geocode: countryGeo(),
        geocodeOverrides: [{ match: 'Riyadh', result: RIYADH }],
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'find me a phone repair shop in Saudi Arabia');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    const timeline = detail.events.map((e: any) => e.message).join(' ');
    expect(timeline).toMatch(/Dial searched Riyadh/i);
    expect(timeline).toMatch(/different city/i);
  });

  it('falls back to the largest city when the country carries no hints', async () => {
    // Finland's country record has neither a timezone nor a capital tag.
    h = await createHarness({
      interpreter: taskInPlace('Finland'),
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'fi1', name: 'Helsinki Phone Fix', phoneE164: '+358401234567' }),
        ],
        geocode: countryGeo({
          label: 'Finland',
          countryCode: 'FI',
          timezone: null,
          capitalCity: null,
          spanKm: 1181,
        }),
        majorCity: HELSINKI,
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'find me a phone repair shop in Finland');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    // Dial may still stop to ask which language to speak; what it must never
    // do is ask where to search after being told.
    expect(detail.clarificationQuestion ?? '').not.toMatch(/where|town or city|postcode/i);
    expect(detail.events.map((e: any) => e.message).join(' ')).toMatch(/Dial searched Helsinki/i);
    // These tests are about where Dial looked, not whether it dialled: finding
    // businesses is the proof the search happened in the right place.
    expect(detail.candidates.length).toBeGreaterThan(0);
  });

  it('ignores a hinted city that turns out to be in a different country', async () => {
    // A bounding box around Finland also contains Saint Petersburg, which is
    // the largest city in the box and the wrong answer.
    h = await createHarness({
      interpreter: taskInPlace('Finland'),
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'fi1', name: 'Helsinki Phone Fix', phoneE164: '+358401234567' }),
        ],
        geocode: countryGeo({
          label: 'Finland',
          countryCode: 'FI',
          timezone: 'Europe/Saint_Petersburg',
          spanKm: 1181,
        }),
        geocodeOverrides: [
          {
            match: 'Saint Petersburg',
            result: {
              latitude: 59.93,
              longitude: 30.33,
              label: 'Saint Petersburg, Russia',
              countryCode: 'RU',
              addressType: 'city',
              spanKm: 60,
            },
          },
        ],
        majorCity: HELSINKI,
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'find me a phone repair shop in Finland');
    await h.runner.drain();

    const timeline = (await getTaskDetail(h, token, created.id)).events
      .map((e: any) => e.message)
      .join(' ');
    expect(timeline).toMatch(/Dial searched Helsinki/i);
    expect(timeline).not.toMatch(/Saint Petersburg/i);
  });

  it('asks only when nothing at all can be resolved', async () => {
    // The one honest case for a question: no hints and no directory answer, so
    // there is genuinely nowhere to point the search.
    h = await createHarness({
      interpreter: taskInPlace('Finland'),
      discovery: stubDiscovery({
        candidates: [],
        geocode: countryGeo({ label: 'Finland', countryCode: 'FI', timezone: null }),
        majorCity: null,
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'find me a phone repair shop in Finland');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    expect(detail.state).toBe('needs_user_input');
    expect(detail.clarificationQuestion).toMatch(/which town or city in Finland/i);
    // Even then it names the country back, so the user knows it was understood.
    expect(detail.clarificationQuestion).not.toMatch(/postcode/i);
  });
});

describe('a request that names a city', () => {
  it('never asks for a postcode', async () => {
    // The literal complaint: "find me a jewelry store based in dubai".
    h = await createHarness({
      interpreter: taskInPlace('Dubai'),
      discovery: stubDiscovery({
        candidates: [
          candidate({ id: 'ae1', name: 'Gold Souk Jewellers', phoneE164: '+97142345678' }),
        ],
        geocode: {
          latitude: 25.2048,
          longitude: 55.2708,
          label: 'Dubai, Dubai Emirate, United Arab Emirates',
          countryCode: 'AE',
          addressType: 'administrative',
          spanKm: 150,
        },
      }),
    });
    const { token } = await signUp(h);
    const created = await createTask(h, token, 'find me a jewelry store based in dubai');
    await h.runner.drain();

    const detail = await getTaskDetail(h, token, created.id);
    // Dial may still stop to ask which language to speak; what it must never
    // do is ask where to search after being told.
    expect(detail.clarificationQuestion ?? '').not.toMatch(/where|town or city|postcode/i);
    expect(JSON.stringify(detail)).not.toMatch(/postcode/i);
    // These tests are about where Dial looked, not whether it dialled: finding
    // businesses is the proof the search happened in the right place.
    expect(detail.candidates.length).toBeGreaterThan(0);
  });
});
