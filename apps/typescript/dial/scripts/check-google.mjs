/**
 * Verifies a Google Maps key against the three APIs Dial uses.
 *
 * Each is checked separately and named in the output, because they are enabled
 * separately on the Google Cloud project and the usual first-run failure is
 * that one of them is not. A single "it didn't work" would send you looking in
 * the wrong place.
 *
 *   node scripts/check-google.mjs
 *
 * Reads GOOGLE_PLACES_API_KEY from .env. Read-only: nothing is created, and no
 * call is placed.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const key = process.env.GOOGLE_PLACES_API_KEY || env.GOOGLE_PLACES_API_KEY;
if (!key) {
  console.error('GOOGLE_PLACES_API_KEY is not set in .env — nothing to check.');
  process.exit(1);
}
console.log(`key: present (${key.length} chars)\n`);

let failures = 0;
function report(api, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${api.padEnd(18)} ${detail}`);
}

/** Geocoding API: a place name becomes coordinates. */
try {
  const r = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('Dubai')}&language=en&key=${encodeURIComponent(key)}`,
  );
  const j = await r.json();
  if (j.status === 'OK') {
    const first = j.results[0];
    report('Geocoding API', true, `Dubai -> ${first.formatted_address} [${first.types?.[0]}]`);
  } else {
    report('Geocoding API', false, `${j.status}: ${j.error_message ?? 'no detail'}`);
  }
} catch (e) {
  report('Geocoding API', false, e.message);
}

/** Time Zone API: only used to turn a country into a searchable city. */
try {
  const r = await fetch(
    `https://maps.googleapis.com/maps/api/timezone/json?location=23.8859,45.0792&timestamp=${Math.floor(Date.now() / 1000)}&key=${encodeURIComponent(key)}`,
  );
  const j = await r.json();
  if (j.status === 'OK') {
    report('Time Zone API', true, `Saudi Arabia -> ${j.timeZoneId}`);
  } else {
    report('Time Zone API', false, `${j.status}: ${j.errorMessage ?? 'no detail'}`);
  }
} catch (e) {
  report('Time Zone API', false, e.message);
}

/** Places API (New): the actual business search. */
try {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.internationalPhoneNumber,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery: 'phone repair shop',
      maxResultCount: 5,
      locationBias: {
        circle: { center: { latitude: 25.2048, longitude: 55.2708 }, radius: 10000 },
      },
    }),
  });
  const j = await r.json();
  if (r.ok) {
    const places = j.places ?? [];
    const withPhone = places.filter((p) => p.internationalPhoneNumber).length;
    report(
      'Places API (New)',
      places.length > 0,
      `${places.length} results near Dubai, ${withPhone} with a phone number`,
    );
    for (const p of places.slice(0, 3)) {
      console.log(
        `          - ${p.displayName?.text} | ${p.internationalPhoneNumber ?? 'no phone'}`,
      );
    }
  } else {
    const status = j?.error?.status ?? r.status;
    const message = j?.error?.message ?? '';
    report('Places API (New)', false, `${status}: ${message}`);
    if (/SERVICE_DISABLED|PERMISSION_DENIED/i.test(String(status) + message)) {
      console.log('          -> Enable "Places API (New)" on the project, and check billing.');
    }
  }
} catch (e) {
  report('Places API (New)', false, e.message);
}

console.log(
  failures === 0
    ? '\nAll three APIs answered. Set DISCOVERY_PROVIDER=google to use them.'
    : `\n${failures} of 3 failed — Dial will not fully work on Google until those are enabled.`,
);
process.exit(failures === 0 ? 0 : 1);
