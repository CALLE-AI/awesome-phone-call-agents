/* Local Atlas backend
   - Serves the static app
   - /api/places : Google Places (New) + Foursquare Places, merged. Keys come
     from GOOGLE_API_KEY / FSQ_API_KEY env vars — set in Render's Environment
     tab; never committed to the repo. Either provider alone is enough.
   - /api/news   : Google News RSS fetched server-side (no CORS proxies)
   - /api/reddit : Reddit search fetched server-side
   - /api/fetch  : generic page fetch for the deals scanner
   All responses share an in-memory TTL cache, so one user's lookup warms
   the next user's. */
const express = require('express');
const path = require('path');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
/* Only for the counter probe on /api/cache-test — the app's own records live
   in store.js, and this file's cache() is a separate, lossier thing. */
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 10000;
const FSQ = process.env.FSQ_API_KEY || '';
const GOOG = process.env.GOOGLE_API_KEY || '';
const TM = process.env.TICKETMASTER_API_KEY || '';
const CENSUS = process.env.CENSUS_API_KEY || '';
const AI = process.env.GEMINI_API_KEY || '';
const OWM = process.env.OPENWEATHER_API_KEY || '';
const NPS = process.env.NPS_API_KEY || '';
const WINDY = process.env.WINDY_API_KEY || '';
const NASA = process.env.NASA_API_KEY || '';
const AI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';  // cheapest tier, auto-tracks latest

/* ---- two-level TTL cache: in-memory L1, optional Upstash Redis L2 ----
   Redis survives restarts and free-tier spin-downs, so one visitor's lookups
   warm the cache for everyone, permanently. Configure with
   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN; works without them. */
const cache = new Map();
const RURL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const RTOK = process.env.UPSTASH_REDIS_REST_TOKEN || '';
/* Redis failures are deliberately silent — a dead cache must not break a
   request. That makes a misconfigured token indistinguishable from a cold
   cache *forever*, so record what actually happened and report it on
   /api/health. `redis: !!RURL` only ever proved an env var was non-empty. */
const redisState = { configured: !!RURL, ok: null, err: '', hits: 0, misses: 0, writes: 0, at: 0 };
function redisNote(ok, err){
  redisState.ok = ok; redisState.at = Date.now();
  redisState.err = ok ? '' : String(err || '').slice(0, 140);
}
async function redisGet(key){
  if(!RURL) return null;
  try{
    const r = await fetch(`${RURL}/get/${encodeURIComponent(key)}`,
      { headers: { Authorization: 'Bearer ' + RTOK } });
    if(!r.ok){ redisNote(false, 'GET HTTP ' + r.status); return null; }
    const j = await r.json();
    redisNote(true);
    const v = typeof j.result === 'string' ? j.result : null;
    if(v == null) redisState.misses++; else redisState.hits++;
    return v;
  }catch(e){ redisNote(false, e.message); return null; }
}
function redisSet(key, val, ttlMs){
  if(!RURL) return;
  // Upstash rejects oversized REST bodies; skip rather than fail every write
  if(val.length > 900000) return;
  fetch(`${RURL}/set/${encodeURIComponent(key)}?px=${Math.max(1000, Math.round(ttlMs))}`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK }, body: val })
    .then(r => { if(r.ok){ redisState.writes++; redisNote(true); } else redisNote(false, 'SET HTTP ' + r.status); })
    .catch(e => redisNote(false, e.message));
}
const encVal = v => Buffer.isBuffer(v) ? 'b64:' + v.toString('base64')
  : typeof v === 'string' ? 'str:' + v : 'jsn:' + JSON.stringify(v);
function decVal(s){
  const tag = s.slice(0, 4), body = s.slice(4);
  if(tag === 'b64:') return Buffer.from(body, 'base64');
  if(tag === 'str:') return body;
  try{ return JSON.parse(body); }catch(e){ return null; }
}
async function cached(key, ttlMs, fn){
  const hit = cache.get(key);
  if(hit && Date.now() - hit.t < ttlMs) return hit.v;
  const rv = await redisGet(key);
  if(rv != null){
    const v = decVal(rv);
    if(v != null){ cache.set(key, { t: Date.now(), v }); return v; }
  }
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  if(cache.size > 600){ cache.delete(cache.keys().next().value); }
  redisSet(key, encVal(v), ttlMs);
  return v;
}

/* Supabase's anon key and URL are public by design — they ship to the browser
   and do nothing without a user token — so they ride along on the health check
   rather than being pasted into index.html, which would put a deploy-specific
   value under version control and make a second deploy impossible to configure
   differently. */
app.get('/api/health', (req, res) => res.json({ ok: true, fsq: !!FSQ, goog: !!GOOG, tm: !!TM, ai: !!AI, owm: !!OWM,
  redis: redisState.configured && redisState.ok !== false, nps: !!NPS, windy: !!WINDY, nasa: !!NASA,
  calle: require('./calle').info(), auth: require('./auth').info() }));

/* Forces a real Upstash round-trip and reports the truth. Use this rather than
   the health flag when asking "is the shared cache actually working?" */
app.get('/api/cache-test', async (req, res) => {
  const out = { configured: !!RURL, url: RURL ? RURL.replace(/^https?:\/\//, '').slice(0, 28) + '…' : '',
    l1Entries: cache.size, ...redisState,
    overpass: { circuitOpen: Date.now() < ovpCircuit.openUntil, tries: ovpCircuit.tries,
      wins: ovpCircuit.wins, lastErr: ovpCircuit.lastErr } };
  if(!RURL) return res.json({ ...out, verdict: 'no UPSTASH_REDIS_REST_URL set — L1 memory cache only' });
  const probe = 'diag:' + Date.now();
  try{
    const t0 = Date.now();
    const w = await fetch(`${RURL}/set/${probe}?px=20000`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK }, body: 'str:ping' });
    if(!w.ok) return res.json({ ...out, verdict: 'WRITE FAILED HTTP ' + w.status + ' — check UPSTASH_REDIS_REST_TOKEN' });
    const r = await fetch(`${RURL}/get/${probe}`, { headers: { Authorization: 'Bearer ' + RTOK } });
    const j = r.ok ? await r.json() : null;
    const ms = Date.now() - t0;
    await fetch(`${RURL}/del/${probe}`, { method: 'POST', headers: { Authorization: 'Bearer ' + RTOK } }).catch(()=>{});

    /* The counter path, checked separately, because it is the one every real
       call goes through and it uses a different Redis verb from everything
       above. A budget reservation that throws would refuse every live call, and
       "the cache is fine" would not have told us. */
    let counter = 'not tested';
    try{
      const ck = 'diag:incr:' + Date.now();
      const a = await store.docIncr(ck, 2, 20000);
      const b = await store.docIncr(ck, -1, 20000);
      const back = await store.docGet(ck);
      await store.docDel(ck);
      counter = (a === 2 && b === 1 && Number(back) === 1)
        ? 'OK — atomic counter works, so budget reservation does'
        : `WRONG: incr=${a} decr=${b} readBack=${back}`;
    }catch(e){ counter = 'ERROR ' + String(e.message || e); }

    return res.json({ ...out, roundTripMs: ms, counter,
      verdict: j?.result === 'str:ping' ? 'OK — shared cache is live' : 'WROTE BUT READ BACK WRONG VALUE' });
  }catch(e){ res.json({ ...out, verdict: 'ERROR ' + String(e.message || e) }); }
});

/* ---- Foursquare places ---- */
/* Legacy v3 was shut down May 15 2026 — this is the new Places API.
   Requires a Service API Key (not a legacy fsq3 key). */
const FSQ_BASE = 'https://places-api.foursquare.com';
const FSQ_HDRS = () => ({ Authorization: 'Bearer ' + FSQ,
  'X-Places-Api-Version': '2025-06-17', Accept: 'application/json' });
const FSQ_CATS = {
  services:    '4d4b7105d754a06375d81259',                          // professional & other
  attractions: '4d4b7104d754a06370d81259,4d4b7105d754a06377d81259', // arts & entertainment, outdoors
  food:        '4d4b7105d754a06374d81259',                          // dining & drinking
  shopping:    '4d4b7105d754a06378d81259',                          // retail
  kids:        '4d4b7104d754a06370d81259',                          // arts & entertainment
  favorites:   '4d4b7105d754a06377d81259'                           // outdoors & recreation
};
/* Foursquare's role here is coverage and contact details, not ratings.
   `hours` and `rating` sit behind a separately-metered premium quota that 429s
   on those fields alone once spent; everything below is free and, measured on
   a Chicago lookup, supplies ~3x more places than Google plus website/phone on
   nearly all of them. Google supplies the ratings, so we don't ask for the
   premium tier unless FSQ_PREMIUM_FIELDS=1 says the quota is worth spending. */
const FSQ_CORE = 'fsq_place_id,name,latitude,longitude,location,categories,distance,website,tel';
const FSQ_PREMIUM = 'hours,rating';
const FSQ_WANT_PREMIUM = process.env.FSQ_PREMIUM_FIELDS === '1';
async function fsqPlaces(category, lat, lon, r){
  const ll = `${encodeURIComponent(lat)}%2C${encodeURIComponent(lon)}`;
  const mkUrl = (fields, withCats) => `${FSQ_BASE}/places/search?ll=${ll}&radius=${r}&limit=50` +
    (withCats ? `&fsq_category_ids=${FSQ_CATS[category]}` : '') +
    (fields ? `&fields=${encodeURIComponent(fields)}` : '');
  // widest tier first, each fallback asking for strictly less
  const tiers = FSQ_WANT_PREMIUM
    ? [[FSQ_CORE + ',' + FSQ_PREMIUM, true], [FSQ_CORE, true], ['', true], ['', false]]
    : [[FSQ_CORE, true], ['', true], ['', false]];
  const data = await cached('fsqb:' + category + ':' + ll + ':' + r, 6 * 3600e3, async () => {
    // 400 = a field/category id was rejected, 429 = that field tier is spent;
    // both are recoverable by asking for less, so drop fields, not the provider
    let last = 0;
    for(const [fields, wc] of tiers){
      const rr = await fetch(mkUrl(fields, wc), { headers: FSQ_HDRS() });
      if(rr.ok) return rr.json();
      last = rr.status;
      if(rr.status !== 400 && rr.status !== 429) break;
    }
    throw new Error('Foursquare HTTP ' + last);
  });
  return (data.results || []).map(p => ({
    fsqId: p.fsq_place_id || p.fsq_id || '',
    name: p.name,
    kind: (p.categories?.[0]?.name || '').toLowerCase(),
    lat: p.latitude ?? p.geocodes?.main?.latitude,
    lon: p.longitude ?? p.geocodes?.main?.longitude,
    dist: (p.distance || 0) / 1609,
    website: p.website || '',
    phone: p.tel || '',
    hours: p.hours?.display || '',
    openNow: typeof p.hours?.open_now === 'boolean' ? p.hours.open_now : null,
    addr: p.location?.formatted_address || '',
    rating: p.rating ?? null,
    src: 'fsq'
  })).filter(p => p.lat != null && p.name);
}

/* ---- Google Places (New) ----
   Nearby Search is a POST with an explicit X-Goog-FieldMask; the mask decides
   both the payload and the billing SKU, so keep it to what the UI actually
   renders. Ratings come back on a 0-5 scale — normalised to Foursquare's 0-10
   below so both providers sort in one list. */
const GOOG_BASE = 'https://places.googleapis.com/v1';
/* Table A place types, grouped to match this app's tabs. The first entry of
   each list is the "core" type used if Google rejects one of the others. */
const GOOG_TYPES = {
  services:    ['bank', 'pharmacy', 'post_office', 'gas_station', 'car_repair', 'hair_salon', 'veterinary_care', 'hospital', 'library'],
  attractions: ['tourist_attraction', 'museum', 'art_gallery', 'park', 'zoo', 'aquarium', 'historical_landmark'],
  food:        ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway'],
  shopping:    ['store', 'shopping_mall', 'supermarket', 'clothing_store', 'department_store', 'book_store', 'hardware_store'],
  kids:        ['playground', 'amusement_park', 'amusement_center', 'water_park', 'zoo', 'aquarium'],
  /* Rec tab. Ordered most-certain-first: the degrade chain below trims from the
     tail, so if Google rejects a newer type the common ones still survive. */
  favorites:   ['golf_course', 'bowling_alley', 'movie_theater', 'marina', 'campground',
                'dog_park', 'hiking_area', 'ski_resort', 'ice_skating_rink', 'swimming_pool',
                'fitness_center', 'national_park']
};
const GOOG_MASK = [
  'places.id', 'places.displayName', 'places.location', 'places.formattedAddress',
  'places.primaryType', 'places.primaryTypeDisplayName', 'places.types', 'places.rating', 'places.userRatingCount',
  'places.priceLevel', 'places.websiteUri', 'places.nationalPhoneNumber', 'places.regularOpeningHours'
].join(',');
const GOOG_PRICE = { PRICE_LEVEL_FREE: 1, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
/* Google returns a useful reason in the body ("API key not valid", "type X is
   not supported", "Places API has not been used in project…") — HTTP 400 alone
   tells you nothing, and this is the one thing you can't test without a key. */
async function googErr(rr){
  try{
    const j = JSON.parse(await rr.text());
    return `HTTP ${rr.status} ${j.error?.status || ''} ${j.error?.message || ''}`.trim();
  }catch(e){ return 'HTTP ' + rr.status; }
}
/* includedTypes matches a place's *secondary* types too, so a science centre
   with an IMAX comes back under movie_theater and a hotel gym under
   fitness_center. Verified live on Rec: hotels, restaurants and art museums.
   Rule: drop a result only when another tab plainly owns its primary identity.
   Deliberately not "primaryType must be in the requested list" — Google's
   restaurants carry specific primary types (pizza_restaurant, italian_...)
   that appear in no list, and that stricter rule would gut the Eat tab. */
const GOOG_OWN = Object.fromEntries(Object.entries(GOOG_TYPES).map(([k, v]) => [k, new Set(v)]));
const GOOG_CLAIMED = new Set(Object.values(GOOG_TYPES).flat());
/* Lodging matches these searches via hotel gyms, pools and marinas but belongs
   on no place tab. Checked after the own-list test so `campground`, which Rec
   legitimately claims, is unaffected. */
const GOOG_NEVER = new Set(['hotel', 'motel', 'resort_hotel', 'extended_stay_hotel',
  'bed_and_breakfast', 'hostel', 'guest_house', 'inn', 'lodging', 'apartment_complex',
  'apartment_building', 'real_estate_agency', 'storage', 'moving_company']);
/* Google qualifies types as <qualifier>_<base>: art_museum, pizza_restaurant,
   grocery_store. Matching the base is what makes this hold together — an exact
   comparison let "art_museum" through on Rec because only "museum" was listed,
   while "pizza_restaurant" has to keep resolving to food, not be orphaned. */
const typeIs = (pt, base) => pt === base || pt.endsWith('_' + base);
const ownsType = (category, pt) => [...(GOOG_OWN[category] || [])].some(t => typeIs(pt, t));
function googOffTopic(category, primaryType){
  if(!primaryType) return false;                       // unknown identity: let it through
  if(ownsType(category, primaryType)) return false;    // this tab's own kind, qualified or not
  if(GOOG_NEVER.has(primaryType)) return true;
  return Object.keys(GOOG_TYPES).some(c => c !== category && ownsType(c, primaryType));
}
function haversineMi(aLat, aLon, bLat, bLon){
  const R = 3958.8, rad = d => d * Math.PI / 180;
  const dLa = rad(bLat - aLat), dLo = rad(bLon - aLon);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function googPlaces(category, lat, lon, r){
  const types = GOOG_TYPES[category];
  const rad = Math.min(r, 50000);                      // Google caps the circle at 50 km
  // gpl2: entries cached before primaryType joined the field mask have no
  // primaryType, so googOffTopic would silently pass everything for 6 h
  // gpl3: entries gained hoursWeek; gpl2 entries have no week to pick from
  const key = `gpl3:${category}:${(+lat).toFixed(4)},${(+lon).toFixed(4)}:${rad}`;
  const data = await cached(key, 6 * 3600e3, async () => {
    /* Google 400s the whole request if any single includedType is unknown to it.
       Trim from the tail rather than collapsing to one type — dropping straight
       to types[0] would silently reduce Rec to nothing but golf courses. */
    let last = '';
    for(const list of [types, types.slice(0, 4), types.slice(0, 1)]){
      const rr = await fetch(`${GOOG_BASE}/places:searchNearby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOG, 'X-Goog-FieldMask': GOOG_MASK },
        body: JSON.stringify({
          includedTypes: list,
          maxResultCount: 20,                          // hard API maximum
          rankPreference: 'POPULARITY',
          locationRestriction: { circle: { center: { latitude: +lat, longitude: +lon }, radius: rad } }
        })
      });
      if(rr.ok) return rr.json();
      last = await googErr(rr);
      // a bad key / disabled API / billing problem won't improve on retry
      if(rr.status !== 400 || /API key|not enabled|billing|PERMISSION/i.test(last)) break;
    }
    throw new Error('Google Places: ' + last);
  });
  const today = new Date().getDay();                   // 0 = Sunday; Google lists Monday first
  return (data.places || []).map(p => {
    const la = p.location?.latitude, lo = p.location?.longitude;
    const days = p.regularOpeningHours?.weekdayDescriptions || [];
    return {
      gid: p.id || '',
      name: p.displayName?.text || '',
      kind: (p.primaryTypeDisplayName?.text || (p.types || [])[0] || '').replaceAll('_', ' ').toLowerCase(),
      lat: la, lon: lo,
      dist: la == null ? 0 : haversineMi(+lat, +lon, la, lo),
      website: p.websiteUri || '',
      phone: p.nationalPhoneNumber || '',
      /* `hours` is kept for frontends served from an old service-worker cache.
         Do not read it in new code: the row is chosen with the server's clock,
         which is UTC here, so from about 7pm Eastern it is tomorrow's row. The
         whole week goes out instead and the viewer picks its own day. */
      hours: days[(today + 6) % 7] || '',
      hoursWeek: days.length === 7 ? days : null,     // Monday first, as Google sends it
      openNow: typeof p.regularOpeningHours?.openNow === 'boolean' ? p.regularOpeningHours.openNow : null,
      addr: p.formattedAddress || '',
      rating: p.rating != null ? Math.round(p.rating * 20) / 10 : null,   // 0-5 → 0-10
      rating5: p.rating ?? null,
      ratingCount: p.userRatingCount ?? null,
      price: GOOG_PRICE[p.priceLevel] ?? null,
      offTopic: googOffTopic(category, p.primaryType),
      src: 'goog'
    };
  }).filter(p => p.lat != null && p.name && !p.offTopic)
    .map(({ offTopic, ...rest }) => rest);
}

/* Cap a best-effort provider call. The underlying promise keeps running and
   still populates the cache, so a timeout costs latency once, not the result. */
function withDeadline(p, ms, label){
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' timed out')), ms); })
  ]);
}

/* Merge providers on normalised name: Google wins ties (fresher hours/ratings),
   Foursquare fills in whatever Google didn't return. */
const normName = n => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
function mergePlaces(lists){
  const out = [], byName = new Map();
  for(const list of lists){
    for(const it of list){
      const k = normName(it.name);
      const prev = byName.get(k);
      if(!prev){ byName.set(k, it); out.push(it); continue; }
      for(const f of ['website', 'phone', 'hours', 'hoursWeek', 'addr', 'kind', 'fsqId', 'gid']){
        if(!prev[f] && it[f]) prev[f] = it[f];
      }
      for(const f of ['rating', 'price', 'openNow', 'rating5', 'ratingCount']){
        if(prev[f] == null && it[f] != null) prev[f] = it[f];
      }
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/* ---- demo place ----
   A test listing that exists so real CALL-E calls dial a line we own instead of
   bothering an actual business. Defaults to an inclusive playground off Amboy
   Road in Wayne, NJ, answered by a Google Voice number.

   Three deliberate constraints, because this is a fabricated listing on a site
   real people use:

   1. **The number is never committed.** It comes from DEMO_PLACE_PHONE, and
      that variable is also the on switch — without it there is no demo place at
      all, so a fork or a fresh deploy cannot inherit someone's phone number.
   2. **It only surfaces near its own coordinates, in its own category.** A
      search of another town cannot turn it up.
   3. **It is flagged `demo: true`** and the name says so, because a stranger
      browsing Wayne must not mistake this for the park's real number and call
      it. Everything else here is honest data; this one entry is not, and it
      says so where someone would actually read it. */
const DEMO = process.env.DEMO_PLACE_PHONE ? {
  name:     process.env.DEMO_PLACE_NAME || 'Amboy Road Inclusive Playground (test listing)',
  lat:      parseFloat(process.env.DEMO_PLACE_LAT || '40.9430'),
  lon:      parseFloat(process.env.DEMO_PLACE_LON || '-74.2228'),
  category: process.env.DEMO_PLACE_CATEGORY || 'kids',
  kind:     process.env.DEMO_PLACE_KIND || 'inclusive playground',
  addr:     process.env.DEMO_PLACE_ADDR || 'Near 20 Amboy Rd, Wayne, NJ 07470',
  phone:    process.env.DEMO_PLACE_PHONE,
  website:  '', hours: '', openNow: null, rating: null, src: 'demo', demo: true
} : null;
const demoUsable = () => DEMO && Number.isFinite(DEMO.lat) && Number.isFinite(DEMO.lon);

/* Returned as its own provider list so it goes through mergePlaces and gets
   sorted by distance with everything else, rather than being pinned to the top
   where it would read as a promoted result. */
function demoList(category, lat, lon, radiusM){
  if(!demoUsable() || category !== DEMO.category) return [];
  const dist = haversineMi(lat, lon, DEMO.lat, DEMO.lon);
  return dist <= radiusM / 1609 ? [{ ...DEMO, dist }] : [];
}

app.get('/api/places', async (req, res) => {
  try{
    if(!FSQ && !GOOG) return res.status(503).json({ error: 'no places key set (GOOGLE_API_KEY or FSQ_API_KEY)' });
    const { lat, lon, radius = '7000', category = 'food', provider = 'both' } = req.query;
    if(!lat || !lon || !FSQ_CATS[category]) return res.status(400).json({ error: 'bad params' });
    const r = Math.min(parseInt(radius, 10) || 7000, 100000);
    const want = p => provider === 'both' || provider === p;
    /* Google is the primary: it is listed first so it wins every merge tie, and
       it gets the longer deadline. Foursquare is a best-effort supplement for
       coverage and contact details — it has been the flaky one, so a slow or
       hung Foursquare must never hold up a response Google already answered.
       The losing request still finishes into the cache, so it isn't wasted. */
    const jobs = [];
    if(GOOG && want('google')) jobs.push(withDeadline(googPlaces(category, lat, lon, r), 10000, 'Google Places'));
    if(FSQ && want('fsq'))     jobs.push(withDeadline(fsqPlaces(category, lat, lon, r), 6000, 'Foursquare'));
    if(!jobs.length) return res.status(503).json({ error: 'provider not configured' });
    const settled = await Promise.allSettled(jobs);
    const lists = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
    if(!lists.length) throw new Error(settled.map(s => String(s.reason?.message || s.reason)).join('; '));
    const demo = demoList(category, +lat, +lon, r);
    if(demo.length) lists.push(demo);
    res.json({ items: mergePlaces(lists) });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- Overpass proxy (OSM places) ----
   This is the slowest call in a place load — measured at ~10 s, and the public
   mirrors 504 under load. It used to run browser -> mirror, so it never touched
   this server and the shared cache could not hold it: one visitor's lookup
   warmed nothing for the next. Proxying it puts OSM results in Redis alongside
   everything else. OSM changes slowly, so the TTL is generous. */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
/* Overpass rate-limits by IP, and Render's outbound IP is shared across many
   services — it is 429'd essentially all the time. Measured from the deployed
   host: overpass-api.de 429/504, the other two mirrors hang past 40 s. So this
   endpoint must NEVER make the browser wait on an upstream fetch it is going to
   lose anyway. A circuit breaker keeps failures at ~1 ms so the client falls
   straight through to its own IP, while still retrying occasionally — one
   success caches a town for everyone for 24 h, which is the whole point. */
const ovpCircuit = { openUntil: 0, lastErr: '', tries: 0, wins: 0 };
const OVP_COOLDOWN = 15 * 60e3;
async function overpassUpstream(q){
  let last = 'no mirror responded';
  for(const url of OVERPASS_MIRRORS.slice(0, 2)){         // two at most; budget over coverage
    try{
      const rr = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(7000) });
      if(rr.ok){ ovpCircuit.wins++; return rr.json(); }
      last = 'HTTP ' + rr.status;
    }catch(e){ last = String(e.message || e); }
  }
  throw new Error(last);
}
app.post('/api/overpass', express.json({ limit: '64kb' }), async (req, res) => {
  try{
    const q = String(req.body?.q || '').slice(0, 8000);
    if(!q) return res.status(400).json({ error: 'q required' });
    const key = 'ovp:v1:' + require('crypto').createHash('sha1').update(q).digest('hex');

    // 1. cache read-through — the only path that reliably pays off
    const hit = cache.get(key);
    if(hit && Date.now() - hit.t < 24 * 3600e3) return res.json(hit.v);
    const rv = await redisGet(key);
    if(rv != null){
      const v = decVal(rv);
      if(v != null){ cache.set(key, { t: Date.now(), v }); return res.json(v); }
    }

    // 2. cache miss: only attempt upstream when the breaker is closed
    if(Date.now() < ovpCircuit.openUntil)
      return res.status(503).json({ miss: true, reason: 'overpass unreachable from server', retry: 'client' });
    ovpCircuit.tries++;
    try{
      const v = await overpassUpstream(q);
      cache.set(key, { t: Date.now(), v });
      if(cache.size > 600) cache.delete(cache.keys().next().value);
      redisSet(key, encVal(v), 24 * 3600e3);
      ovpCircuit.openUntil = 0;
      return res.json(v);
    }catch(e){
      ovpCircuit.openUntil = Date.now() + OVP_COOLDOWN;
      ovpCircuit.lastErr = String(e.message || e).slice(0, 120);
      return res.status(503).json({ miss: true, reason: ovpCircuit.lastErr, retry: 'client' });
    }
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- kids-safety pass ----
   The Kids tab inherits adult venues by construction: FSQ_CATS.kids is
   Foursquare's whole "Arts & Entertainment" tree (tattoo parlours, nightlife,
   the lot) and Google files tattoo studios under art galleries. Two stages —
   a blocklist that costs nothing and works with no API key, then Gemini on
   whatever is left. Fails open: a filter outage must never empty the tab. */
const KIDS_BLOCK = /\b(tattoo|piercing|body\s?art|vape|smoke\s?shop|head\s?shop|cannabis|marijuana|dispensary|cbd|liquor|winery|wine\s?bar|spirits|brewery|brewpub|distillery|taproom|beer\s?garden|pub|tavern|saloon|lounge|nightclub|night\s?club|casino|gambling|adult|lingerie|gentlemen'?s|strip\s?club|hookah|cigar|tobacco|pawn|firearm|ammo|rifle|pistol|handgun|shooting|sharpshoot\w*|gun\s?(shop|range|club|store)|indoor\s?range|funeral|mortuary|cemetery|cremator|bail\s?bonds|payday\s?loan|massage\s?parlou?r)\b/i;
/* "Juice Bar" is not a bar — only treat a bare "bar" as adult when nothing
   food-shaped qualifies it. */
const KIDS_BAR = /\bbars?\b/i;
const KIDS_BAR_OK = /\b(juice|salad|snack|smoothie|coffee|sushi|oxygen|candy|cereal|yogurt|milk|soda|ice\s?cream|taco|noodle|sandwich|bagel|donut|doughnut)\s?bar\b/i;
function kidsBlocked(name, kind){
  const t = `${name || ''} ${kind || ''}`;
  if(KIDS_BLOCK.test(t)) return true;
  return KIDS_BAR.test(t) && !KIDS_BAR_OK.test(t);
}
app.post('/api/kids-filter', express.json({ limit: '120kb' }), async (req, res) => {
  try{
    const list = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 80)
      .map(i => ({ name: String(i?.name || '').slice(0, 90), kind: String(i?.kind || '').slice(0, 60) }));
    if(!list.length) return res.json({ drop: [], why: {} });
    const drop = new Set(), why = {};
    const undecided = [];
    list.forEach((it, i) => {
      if(kidsBlocked(it.name, it.kind)){ drop.add(i); why[i] = 'category not suitable for children'; }
      else undecided.push(i);
    });
    if(AI && undecided.length){
      try{
        const key = 'kidsf:v1:' + require('crypto').createHash('sha1')
          .update(JSON.stringify(undecided.map(i => list[i]))).digest('hex');
        const verdicts = await cached(key, 180 * 86400e3, async () => geminiJSON(
`Below is a numbered list of real businesses and places that a family app is about to show on a "Kids" tab — places to take children. Some are miscategorised by the data provider and are not remotely child-appropriate (tattoo studios filed as art galleries, bars filed as entertainment, vape shops, adult venues, gun ranges, etc.).

Return ONLY a JSON array naming the entries that should NOT appear on a children's tab. If every entry is fine, return []. Judge by what the place actually is, not by its label. Keep genuinely kid-relevant places (playgrounds, parks, zoos, museums, libraries, arcades, ice cream, family restaurants, swim schools) even if the label is odd.
[{"i":3,"why":"tattoo studio"}]

PLACES:
${undecided.map(i => `${i}. ${list[i].name} — ${list[i].kind || 'unknown'}`).join('\n')}`, 900));
        for(const v of (Array.isArray(verdicts) ? verdicts : [])){
          const i = Number(v?.i);
          if(Number.isInteger(i) && i >= 0 && i < list.length && !drop.has(i)){
            drop.add(i); why[i] = String(v?.why || 'flagged as not child-appropriate').slice(0, 80);
          }
        }
      }catch(e){ /* fail open: keep the blocklist result */ }
    }
    res.json({ drop: [...drop].sort((a, b) => a - b), why, ai: !!AI });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- local news (Google News RSS, server-side) ----
   Google News search is token-based, so a bare town name matches the wrong town
   in the wrong state: "Wayne" pulls in Fort Wayne IN and Wayne County MI. Two
   defences — pin the region into the query, then drop any result whose only
   mention of the town belongs to a different place. */
const CA_PROVINCES = [['Ontario','ON'],['Quebec','QC'],['British Columbia','BC'],['Alberta','AB'],
  ['Manitoba','MB'],['Saskatchewan','SK'],['Nova Scotia','NS'],['New Brunswick','NB'],
  ['Newfoundland and Labrador','NL'],['Prince Edward Island','PE'],['Yukon','YT'],
  ['Northwest Territories','NT'],['Nunavut','NU']];
let _regionPairs = null;
function regionPairs(){            // lazy: STATES is declared further down the file
  if(!_regionPairs) _regionPairs = [...STATES.map(s => [s[0], s[1]]), ...CA_PROVINCES];
  return _regionPairs;
}
function regionForms(region){
  const r = String(region || '').trim();
  if(!r) return { name: '', abbr: '' };
  const lc = r.toLowerCase();
  const hit = regionPairs().find(([n, a]) => n.toLowerCase() === lc || a.toLowerCase() === lc);
  return hit ? { name: hit[0], abbr: hit[1] } : { name: r, abbr: '' };
}
/* Words that, in front of our town's name, make it a *different* town.
   "Wayne" vs "Fort Wayne"; "Orange" vs "West Orange". */
const LEAD_QUALIFIERS = new Set(['fort', 'ft', 'west', 'east', 'north', 'south', 'new', 'old',
  'lake', 'mount', 'mt', 'port', 'saint', 'st', 'upper', 'lower', 'big', 'little', 'glen',
  'cape', 'castle', 'white', 'green', 'grand', 'high', 'long', 'red', 'black']);
const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* true when the text names our town in its own right, rather than only as part
   of a longer place name */
function namesOwnTown(text, place){
  const rx = new RegExp('([a-z]+\\.?\\s+)?\\b' + rxEsc(place.toLowerCase()) + '\\b', 'g');
  let m, seen = false, standalone = false;
  while((m = rx.exec(text))){
    seen = true;
    const prev = (m[1] || '').trim().replace(/\.$/, '');
    if(!LEAD_QUALIFIERS.has(prev)) standalone = true;
  }
  return { seen, standalone };
}
function newsVerdict(text, place, forms){
  const t = text.toLowerCase();
  const own = namesOwnTown(t, place);
  // every mention was "Fort Wayne"-style → a different town entirely
  if(own.seen && !own.standalone) return 'wrong-town';
  const ourName = forms.name.toLowerCase();
  const mentionsOurs = !!ourName &&
    (t.includes(ourName) || (forms.abbr && new RegExp('\\b' + forms.abbr + '\\b', 'i').test(text)));
  if(mentionsOurs) return 'strong';
  // names some other state/province and never ours → almost certainly elsewhere
  const other = regionPairs().some(([n]) => {
    const nl = n.toLowerCase();
    return nl !== ourName && nl !== place.toLowerCase() && t.includes(nl);
  });
  return other ? 'wrong-region' : 'weak';
}
app.get('/api/news', async (req, res) => {
  try{
    const q = String(req.query.q || '').slice(0, 80);
    const cc = req.query.country === 'CA' ? 'CA' : 'US';
    if(!q) return res.status(400).json({ error: 'q required' });
    const forms = regionForms(req.query.region);
    // quoting both terms makes Google AND them, which alone kills most wrong-state hits
    const search = forms.name ? `"${q}" "${forms.name}"` : `"${q}" local news`;
    const feed = 'https://news.google.com/rss/search' +
      `?q=${encodeURIComponent(search)}&hl=en-${cc}&gl=${cc}&ceid=${cc}:en`;
    const xml = await cached('news2:' + feed, 15 * 60e3, async () => {
      const rr = await fetch(feed);
      if(!rr.ok) throw new Error('feed HTTP ' + rr.status);
      return rr.text();
    });
    const items = [];
    const pick = (b, t) => {
      const m = b.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>'));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    const rx = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while((m = rx.exec(xml)) && items.length < 24){
      const it = { title: pick(m[1], 'title'), link: pick(m[1], 'link'),
                   pub: pick(m[1], 'pubDate'), src: pick(m[1], 'source') };
      it.verdict = newsVerdict(it.title + ' ' + it.src, q, forms);
      items.push(it);
    }
    /* Only ever drop stories positively identified as somewhere else. A local
       story from a local outlet often names neither the state nor the abbrev
       ("Wayne council approves park - NorthJersey.com") — that is weak evidence,
       not wrong evidence, so it stays; it just ranks below a confirmed match. */
    const rank = { strong: 0, weak: 1 };
    const kept = items.filter(i => i.verdict === 'strong' || i.verdict === 'weak')
      .sort((a, b) => rank[a.verdict] - rank[b.verdict])
      .slice(0, 12).map(({ verdict, ...rest }) => rest);
    res.json({ items: kept, dropped: items.length - kept.length });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- Reddit search (server-side) ---- */
app.get('/api/reddit', async (req, res) => {
  try{
    const q = String(req.query.q || '').slice(0, 120);
    if(!q) return res.status(400).json({ error: 'q required' });
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=12&t=month`;
    const data = await cached('rd:' + url, 10 * 60e3, async () => {
      const rr = await fetch(url, { headers: { 'User-Agent': 'local-atlas/1.0 (personal project)' } });
      if(!rr.ok) throw new Error('reddit HTTP ' + rr.status);
      const txt = await rr.text();
      if(txt.trim().startsWith('<')) throw new Error('reddit blocked this host');
      return JSON.parse(txt);
    });
    res.json(data);
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- generic page fetch for the deals scanner ----
   This endpoint takes a URL from anyone and fetches it from inside our network,
   which is the shape of every SSRF. Three things make that safe, and all three
   are needed:

     1. the address, not the name. A hostname check can be walked straight past
        by `deals.example.com  A  169.254.169.254`, by decimal and octal spellings
        of a v4 address, and by every v4-mapped v6 form of localhost. So what is
        judged is the resolved IP, and a name that resolves anywhere private is
        refused whatever it is called.
     2. every hop. `redirect: 'follow'` checked the URL the caller handed us and
        then let the *server* pick the next one — a public URL is allowed to
        answer `302 Location: http://169.254.169.254/latest/meta-data/`. Redirects
        are followed by hand here so each target goes through the same check as
        the first.
     3. the address we checked is the address we connect to. The guard is
        installed as the socket's own `lookup`, so there is no window between
        resolving a name and connecting to it for a second answer to arrive
        (DNS rebinding); the connection can only go to an address that passed. */
const MAX_HOPS = 4;
const FETCH_TIMEOUT = 10000;
const FETCH_MAX_BYTES = 500000;

/* Everything that is not a public destination: loopback, the RFC1918 ranges,
   link-local — which is where the cloud metadata service lives on 169.254.169.254
   — carrier NAT, multicast and reserved space. Unparseable means refused. */
function isBlockedIp(ip){
  if(net.isIPv4(ip)){
    const [a, b] = ip.split('.').map(Number);
    if(a === 0 || a === 10 || a === 127) return true;            // this-host, private, loopback
    if(a === 169 && b === 254) return true;                      // link-local + metadata
    if(a === 172 && b >= 16 && b <= 31) return true;             // private
    if(a === 192 && b === 168) return true;                      // private
    if(a === 192 && b === 0) return true;                        // protocol assignments
    if(a === 100 && b >= 64 && b <= 127) return true;            // carrier-grade NAT
    if(a >= 224) return true;                                    // multicast, reserved, broadcast
    return false;
  }
  if(net.isIPv6(ip)){
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    /* ::ffff:127.0.0.1 and ::ffff:7f00:1 are the same address wearing different
       clothes, and both reach loopback. Judge the v4 address inside. */
    const dotted = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if(dotted) return isBlockedIp(dotted[1]);
    const hex = s.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
    if(hex){
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return isBlockedIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    if(s === '::' || s === '::1') return true;                   // unspecified, loopback
    if(/^f[cd]/.test(s)) return true;                            // unique local fc00::/7
    if(/^fe[89ab]/.test(s)) return true;                         // link-local fe80::/10
    if(/^ff/.test(s)) return true;                               // multicast
    return false;
  }
  return true;
}

/* Drop-in for net.connect's `lookup`. Resolves as usual, refuses if any answer
   is private, and hands back only the answers it checked. */
function guardedLookup(hostname, options, cb){
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if(err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [addrs];
    const bad = list.find(a => isBlockedIp(a.address));
    if(bad) return cb(new Error(`blocked address ${bad.address} for ${hostname}`));
    if(options && options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function checkedUrl(raw, base){
  const u = base ? new URL(raw, base) : new URL(raw);
  if(!/^https?:$/.test(u.protocol)) throw new Error('bad protocol: ' + u.protocol);
  if(!u.hostname) throw new Error('no host');
  /* A literal address never reaches the guard above, because a socket given an
     IP has nothing to resolve and so never calls `lookup` — so literals are
     judged here instead. The URL parser has already folded every alternative
     spelling into a plain one by this point (`0177.0.0.1` and `2130706433` both
     parse as `127.0.0.1`), which is why one check covers all of them. */
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if(net.isIP(host) && isBlockedIp(host)) throw new Error('blocked address ' + host);
  return u;
}

function requestOnce(u){
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      lookup: guardedLookup,
      /* Identity, so the size cap below counts the bytes we actually keep and
         the body needs no decoding to be text. */
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; local-atlas)',
                 'Accept-Encoding': 'identity' },
      timeout: FETCH_TIMEOUT
    }, resolve);
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

function readCapped(res, maxBytes){
  return new Promise((resolve, reject) => {
    let out = '';
    res.setEncoding('utf8');
    res.on('data', c => {
      if(out.length >= maxBytes) return;
      out += c.slice(0, maxBytes - out.length);
      if(out.length >= maxBytes) res.destroy();
    });
    res.on('end', () => resolve(out));
    res.on('close', () => resolve(out));
    res.on('error', reject);
  });
}

async function guardedFetchText(raw){
  let u = checkedUrl(raw);
  for(let hop = 0; ; hop++){
    const res = await requestOnce(u);
    const code = res.statusCode;
    if(code >= 300 && code < 400 && res.headers.location){
      res.resume();                                   // drain, we only want the header
      if(hop >= MAX_HOPS) throw new Error('too many redirects');
      u = checkedUrl(res.headers.location, u);        // ← the hop the old code trusted
      continue;
    }
    if(code < 200 || code >= 300){ res.resume(); throw new Error('HTTP ' + code); }
    return readCapped(res, FETCH_MAX_BYTES);
  }
}

app.get('/api/fetch', async (req, res) => {
  try{
    const u = checkedUrl(String(req.query.url || ''));
    const txt = await cached('f:' + u.href, 3600e3, () => guardedFetchText(u.href));
    res.type('text/plain').send(txt);
  }catch(e){ res.status(502).send('fetch failed: ' + String(e.message || e)); }
});

/* ---- Top US States leaderboards ---- */
const STATES = [
 ['Alabama','AL',32.8,-86.8],['Alaska','AK',64.0,-152.0],['Arizona','AZ',34.2,-111.6],
 ['Arkansas','AR',34.8,-92.4],['California','CA',37.2,-119.3],['Colorado','CO',39.0,-105.5],
 ['Connecticut','CT',41.6,-72.7],['Delaware','DE',39.0,-75.5],['Florida','FL',28.6,-82.4],
 ['Georgia','GA',32.6,-83.4],['Hawaii','HI',20.8,-156.3],['Idaho','ID',44.4,-114.6],
 ['Illinois','IL',40.0,-89.2],['Indiana','IN',39.9,-86.3],['Iowa','IA',42.0,-93.5],
 ['Kansas','KS',38.5,-98.4],['Kentucky','KY',37.5,-85.3],['Louisiana','LA',31.0,-92.0],
 ['Maine','ME',45.4,-69.2],['Maryland','MD',39.0,-76.8],['Massachusetts','MA',42.3,-71.8],
 ['Michigan','MI',44.3,-85.4],['Minnesota','MN',46.3,-94.3],['Mississippi','MS',32.7,-89.7],
 ['Missouri','MO',38.4,-92.5],['Montana','MT',47.0,-109.6],['Nebraska','NE',41.5,-99.8],
 ['Nevada','NV',39.3,-116.6],['New Hampshire','NH',43.7,-71.6],['New Jersey','NJ',40.2,-74.7],
 ['New Mexico','NM',34.4,-106.1],['New York','NY',42.9,-75.5],['North Carolina','NC',35.5,-79.4],
 ['North Dakota','ND',47.4,-100.5],['Ohio','OH',40.3,-82.8],['Oklahoma','OK',35.6,-97.5],
 ['Oregon','OR',43.9,-120.6],['Pennsylvania','PA',40.9,-77.8],['Rhode Island','RI',41.7,-71.6],
 ['South Carolina','SC',33.9,-80.9],['South Dakota','SD',44.4,-100.2],['Tennessee','TN',35.9,-86.4],
 ['Texas','TX',31.5,-99.4],['Utah','UT',39.3,-111.7],['Vermont','VT',44.1,-72.7],
 ['Virginia','VA',37.5,-78.9],['Washington','WA',47.4,-120.4],['West Virginia','WV',38.6,-80.6],
 ['Wisconsin','WI',44.6,-89.7],['Wyoming','WY',43.0,-107.6]
];
async function geminiJSON(prompt, maxTokens){
  if(!AI) throw new Error('no AI key');
  const rr = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });
  if(!rr.ok) throw new Error('Gemini HTTP ' + rr.status);
  const j = await rr.json();
  const txt = (j.candidates?.[0]?.content?.parts || []).map(pt => pt.text || '').join('');
  const m = txt.match(/\[[\s\S]*\]/);
  return JSON.parse(m ? m[0] : txt.replace(/```json|```/g, '').trim());
}
function rssItems(xml, limit){
  const out = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while((m = rx.exec(xml)) && out.length < limit){
    const block = m[1];
    const tm = block.match(/<title>([\s\S]*?)<\/title>/);
    const lm = block.match(/<link>([\s\S]*?)<\/link>/);
    if(!tm) continue;
    let t = tm[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    if(t.includes(' - ')) t = t.split(' - ').slice(0, -1).join(' - ');
    out.push({ title: t, link: lm ? lm[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '' });
  }
  return out;
}
async function mapLimit(items, limit, fn){
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while(i < items.length){ const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/* Weirdest state: "<State> man" headlines, AI-judged for absurdity */
app.get('/api/states/weird', async (req, res) => {
  try{
    const data = await cached('st:weird:v2', 24 * 3600e3, async () => {
      const perState = await mapLimit(STATES, 6, async ([name, abbr, lat, lon]) => {
        try{
          const feed = 'https://news.google.com/rss/search?q=' +
            encodeURIComponent(`"${name} man"`) + '&hl=en-US&gl=US&ceid=US:en';
          const rr = await fetch(feed);
          if(!rr.ok) return { name, abbr, lat, lon, items: [] };
          return { name, abbr, lat, lon, items: rssItems(await rr.text(), 8) };
        }catch(e){ return { name, abbr, lat, lon, items: [] }; }
      });
      let ranked;
      try{
        const compact = Object.fromEntries(perState.filter(st => st.items.length)
          .map(st => [st.name, st.items.map(i => i.title)]));
        ranked = await geminiJSON(
`Below are recent news headlines that begin with or feature "<State> man". Score each state 0-10 for how absurd, silly, shocking, or dumb its "<State> man" stories are — the "Florida Man" phenomenon. Respond ONLY with a JSON array of the 12 weirdest states, best first:
[{"state":"...","score":9.4,"headlines":["up to 3 of the funniest verbatim headlines for that state, funniest first"]}]

HEADLINES:
${JSON.stringify(compact).slice(0, 14000)}`, 1200);
      }catch(e){
        ranked = perState.map(st => ({ state: st.name, score: st.items.length,
            headlines: st.items.slice(0, 3).map(i => i.title) }))
          .sort((a, b) => b.score - a.score).slice(0, 12);
      }
      const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
      return ranked.map(r => {
        const st = STATES.find(x => x[0] === r.state);
        const src = perState.find(x => x.name === r.state);
        const headlines = (r.headlines || []).map(h => {
          const nh = norm(h);
          const hit = (src?.items || []).find(i => {
            const ni = norm(i.title);
            return ni === nh || ni.includes(nh.slice(0, 40)) || nh.includes(ni.slice(0, 40));
          });
          return { title: h, url: hit?.link || '' };
        });
        return { ...r, headlines, abbr: st?.[1] || '', lat: st?.[2], lon: st?.[3] };
      });
    });
    res.json({ items: data });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* Most happening: Ticketmaster volume + national-park events + festivals (AI-blended) */
app.get('/api/states/events', async (req, res) => {
  try{
    if(!TM) return res.status(503).json({ error: 'events not configured' });
    const data = await cached('st:events:v2', 12 * 3600e3, async () => {
      const start = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const end = new Date(Date.now() + 30 * 864e5).toISOString().replace(/\.\d+Z$/, 'Z');
      const rows = await mapLimit(STATES, 3, async ([name, abbr, lat, lon]) => {
        const row = { state: name, abbr, lat, lon, count: 0, top: '', nps: 0 };
        try{
          const url = 'https://app.ticketmaster.com/discovery/v2/events.json' +
            `?apikey=${TM}&stateCode=${abbr}&size=1&startDateTime=${start}&endDateTime=${end}`;
          const rr = await fetch(url);
          if(rr.ok){
            const j = await rr.json();
            row.count = j.page?.totalElements || 0;
            row.top = j._embedded?.events?.[0]?.name || '';
          }
          await new Promise(r => setTimeout(r, 120));
        }catch(e){}
        if(NPS){
          try{
            const nr = await fetch(`https://developer.nps.gov/api/v1/events?stateCode=${abbr}&pageSize=1&api_key=${NPS}`);
            if(nr.ok){ row.nps = parseInt((await nr.json()).total, 10) || 0; }
          }catch(e){}
        }
        return row;
      });
      const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      let ranked;
      try{
        const compact = rows.map(r => ({ state: r.state, ticketed: r.count, parkEvents: r.nps }));
        const ai = await geminiJSON(
`It is ${month}. Below is per-state data: ticketed events in the next 30 days${NPS ? ' and national-park events' : ''}. Rank the 12 "most happening" US states for a visitor this month — blend the numbers with well-known festivals, state fairs, harvest celebrations, and cultural events that traditionally occur in ${month.split(' ')[0]}. Do not just rank by population or raw counts. Respond ONLY with a JSON array, best first:
[{"state":"...","festival":"one notable festival/fair/celebration in that state this month (empty string if none)","note":"one short sentence on why this state is happening right now"}]

DATA:
${JSON.stringify(compact)}`, 1400);
        ranked = ai.map(r => ({ ...rows.find(x => x.state === r.state), festival: r.festival || '', note: r.note || '' }))
          .filter(r => r.state);
      }catch(e){
        ranked = rows.sort((a, b) => b.count - a.count).slice(0, 12)
          .map(r => ({ ...r, festival: '', note: '' }));
      }
      return ranked;
    });
    res.json({ items: data });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* Top surf towns: curated US/Canada surf spots, scored live on current waves */
const SURF_TOWNS = [
  ['Huntington Beach, CA', 33.66, -118.00], ['Santa Cruz, CA', 36.96, -122.02],
  ['Malibu, CA', 34.03, -118.68], ['San Diego, CA', 32.72, -117.26],
  ['Ventura, CA', 34.27, -119.29], ['Oceanside, CA', 33.19, -117.38],
  ['Cocoa Beach, FL', 28.32, -80.61], ['Jacksonville Beach, FL', 30.29, -81.39],
  ['Kill Devil Hills, NC', 36.03, -75.68], ['Wrightsville Beach, NC', 34.21, -77.80],
  ['Montauk, NY', 41.04, -71.95], ['Ocean City, NJ', 39.28, -74.57],
  ['Virginia Beach, VA', 36.85, -75.98], ['Folly Beach, SC', 32.65, -79.94],
  ['Galveston, TX', 29.28, -94.79], ['Pacific City, OR', 45.20, -123.96],
  ['Newport, RI', 41.49, -71.31], ['Honolulu, HI', 21.28, -157.83],
  ['Hilo, HI', 19.73, -155.09], ['Tofino, BC', 49.15, -125.91]
];
app.get('/api/states/surf', async (req, res) => {
  try{
    const data = await cached('st:surf', 3 * 3600e3, async () => {
      const rows = await mapLimit(SURF_TOWNS, 4, async ([name, lat, lon]) => {
        try{
          const u = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
            `&current=wave_height,wave_period,swell_wave_height&daily=wave_height_max&timezone=auto&forecast_days=3&length_unit=imperial`;
          const d = await (await fetch(u)).json();
          const c = d.current || {};
          const wave = c.wave_height || 0, period = c.wave_period || 0, swell = c.swell_wave_height || 0;
          // simple surf score: wave height + swell quality + period (cleaner longer-period swell rates higher)
          const score = wave * 3 + swell * 2 + period * 0.5;
          return { town: name, lat, lon, wave, period, swell, score: Math.round(score * 10) / 10 };
        }catch(e){ return { town: name, lat, lon, wave: 0, period: 0, swell: 0, score: 0 }; }
      });
      return rows.filter(r => r.wave > 0).sort((a, b) => b.score - a.score).slice(0, 12);
    });
    res.json({ items: data });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* Best to visit this month: AI seasonal picks */
app.get('/api/states/visit', async (req, res) => {
  try{
    if(!AI) return res.status(503).json({ error: 'not configured' });
    const monthKey = new Date().toISOString().slice(0, 7);
    const data = await cached('st:visit:v2:' + monthKey, 24 * 3600e3, async () => {
      const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const ranked = await geminiJSON(
`It is ${month}. Rank the 10 best US states to visit this month, considering typical weather, seasonal scenery, festivals, and outdoor conditions. Respond ONLY with a JSON array, best first:
[{"state":"...","why":"one concrete sentence on why this month specifically","site":"the official state tourism board homepage URL, e.g. https://www.visitcalifornia.com"}]`, 1100);
      return ranked.map(r => {
        const st = STATES.find(x => x[0] === r.state);
        const site = typeof r.site === 'string' && /^https?:\/\//.test(r.site) ? r.site : '';
        return { ...r, site, abbr: st?.[1] || '', lat: st?.[2], lon: st?.[3] };
      });
    });
    res.json({ items: data });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- Quirky laws (Gemini, cached permanently per location) ---- */
async function lawsFor(scope, place, region){
  // long TTL: folklore doesn't change. Redis makes this a one-time cost per place.
  const key = 'laws:' + scope + ':' + place.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cached(key, 365 * 86400e3, async () => {
    const where = scope === 'state' ? `the US state of ${place}` : `${place}${region ? ', ' + region : ''}`;
    const ranked = await geminiJSON(
`List 5-7 quirky, unusual, funny, or surprising laws or ordinances associated with ${where}. Prefer genuinely local specifics over generic ones. For each, give a one-line plain description. Many such laws are historical, rarely enforced, or possibly apocryphal — reflect that honestly in a "status" field. Respond ONLY with a JSON array:
[{"law":"short description of the law","status":"one of: on the books, historical, rarely enforced, or disputed"}]`, 1100);
    return Array.isArray(ranked) ? ranked.slice(0, 7) : [];
  });
}
app.get('/api/taxes', async (req, res) => {
  try{
    if(!AI) return res.status(503).json({ error: 'not configured' });
    const stName = String(req.query.state || '').slice(0, 40);
    if(!stName) return res.status(400).json({ error: 'state required' });
    const data = await cached('taxes:' + stName.toLowerCase().replace(/[^a-z]/g, ''), 180 * 86400e3, async () => {
      return geminiJSON(
`Give current general tax and common government-fee information for the US state of ${stName}. Use typical/approximate figures where exact varies locally, and note when something varies. Respond ONLY with a JSON array of {"label":"...","value":"..."} pairs covering: state sales tax rate, state income tax (rate or range, or "none"), gas tax, vehicle registration (typical annual/base cost), and typical real-estate transfer or recording context if notable. Keep values short.
[{"label":"Sales tax","value":"6.625%"}]`, 900);
    });
    res.json({ items: Array.isArray(data) ? data : [] });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

app.get('/api/laws', async (req, res) => {
  try{
    if(!AI) return res.status(503).json({ error: 'not configured' });
    const scope = req.query.scope === 'town' ? 'town' : 'state';
    const place = String(req.query.place || '').slice(0, 80);
    const region = String(req.query.region || '').slice(0, 40);
    if(!place) return res.status(400).json({ error: 'place required' });
    const laws = await lawsFor(scope, place, region);
    res.json({ laws });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- Ticketmaster events ---- */
app.get('/api/events', async (req, res) => {
  try{
    if(!TM) return res.status(503).json({ error: 'TICKETMASTER_API_KEY not set' });
    const { lat, lon, radius = '25' } = req.query;
    if(!lat || !lon) return res.status(400).json({ error: 'bad params' });
    const r = Math.min(parseInt(radius, 10) || 25, 100);
    const url = 'https://app.ticketmaster.com/discovery/v2/events.json' +
      `?apikey=${TM}&latlong=${encodeURIComponent(lat)},${encodeURIComponent(lon)}` +
      `&radius=${r}&unit=miles&sort=date,asc&size=30`;
    const data = await cached('tm:' + url, 30 * 60e3, async () => {
      const rr = await fetch(url);
      if(!rr.ok) throw new Error('Ticketmaster HTTP ' + rr.status);
      return rr.json();
    });
    const events = (data._embedded?.events || []).map(e => ({
      name: e.name, url: e.url || '',
      date: e.dates?.start?.localDate || '', time: e.dates?.start?.localTime || '',
      venue: e._embedded?.venues?.[0]?.name || '',
      img: (e.images || []).find(i => i.ratio === '16_9' && i.width >= 300)?.url || e.images?.[0]?.url || '',
      seg: e.classifications?.[0]?.segment?.name || ''
    }));
    res.json({ events });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- county profile (FCC geo → Census ACS; key optional but recommended) ---- */
app.get('/api/census', async (req, res) => {
  try{
    const { lat, lon } = req.query;
    if(!lat || !lon) return res.status(400).json({ error: 'bad params' });
    const out = await cached(`cs6:${(+lat).toFixed(3)},${(+lon).toFixed(3)}`, 30 * 86400e3, async () => {
      const key = CENSUS ? '&key=' + CENSUS : '';
      const vars = 'NAME,B01003_001E,B19013_001E,B01002_001E,B25077_001E,B25064_001E,B25103_001E';   // +median home value, gross rent, property tax
      // Census geocoder → the incorporated city/town containing this point.
      // Only these two layers matter; we deliberately do NOT request sub-place
      // or tract layers, which is what surfaced neighborhoods before.
      // Incorporated Places covers cities; County Subdivisions covers townships
      // (NJ/PA/New England/MI), which aren't "places" in Census geography.
      const gr = await fetch('https://geocoding.geo.census.gov/geocoder/geographies/coordinates' +
        `?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current` +
        '&layers=Incorporated%20Places,County%20Subdivisions,Counties&format=json');
      if(!gr.ok) throw new Error('Census geocoder HTTP ' + gr.status);
      const geos = (await gr.json())?.result?.geographies || {};
      const place = (geos['Incorporated Places'] || [])[0];
      const subdiv = (geos['County Subdivisions'] || [])[0];
      const county = (geos['Counties'] || [])[0];

      const getRow = async (forClause) => {
        const cr = await fetch(`https://api.census.gov/data/2023/acs/acs5?get=${vars}&${forClause}${key}`);
        if(!cr.ok) return null;
        const j = await cr.json();
        return Array.isArray(j) && j[1] ? j[1] : null;
      };
      const clean = n => (n||'').replace(/,.*$/, '');

      // 1) incorporated city/town
      if(place?.STATE && place?.PLACE){
        const row = await getRow(`for=place:${place.PLACE}&in=state:${place.STATE}`);
        if(row && +row[1] > 0)
          return { area: clean(row[0]), level: 'town',
            population: +row[1], medianIncome: +row[2], medianAge: +row[3],
            homeValue: +row[4] || null, rent: +row[5] || null, propertyTax: +row[6] || null };
      }
      // 2) township / county subdivision (skip "not defined" subdivisions, code 00000)
      if(subdiv?.STATE && subdiv?.COUNTY && subdiv?.COUSUB && subdiv.COUSUB !== '00000'){
        const row = await getRow(`for=county%20subdivision:${subdiv.COUSUB}&in=state:${subdiv.STATE}%20county:${subdiv.COUNTY}`);
        if(row && +row[1] > 0)
          return { area: clean(row[0]), level: 'town',
            population: +row[1], medianIncome: +row[2], medianAge: +row[3],
            homeValue: +row[4] || null, rent: +row[5] || null, propertyTax: +row[6] || null };
      }
      // 3) county fallback
      if(county?.STATE && county?.COUNTY){
        const row = await getRow(`for=county:${county.COUNTY}&in=state:${county.STATE}`);
        if(row)
          return { area: row[0], level: 'county',
            population: +row[1], medianIncome: +row[2], medianAge: +row[3],
            homeValue: +row[4] || null, rent: +row[5] || null, propertyTax: +row[6] || null };
      }
      throw new Error('outside US census coverage');
    });
    res.json(out);
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- place details (photo, rating, price, blurb) — Foursquare or Google ---- */
async function fsqDetails(id){
  return cached('fdn:' + id, 86400e3, async () => {
    const out = { rating: null, price: null, photo: '', blurb: '', src: 'fsq' };
    try{
      const rr = await fetch(`${FSQ_BASE}/places/${id}?fields=rating%2Cprice`, { headers: FSQ_HDRS() });
      if(rr.ok){ const j = await rr.json(); out.rating = j.rating ?? null; out.price = j.price ?? null; }
    }catch(e){}
    try{
      const pr = await fetch(`${FSQ_BASE}/places/${id}/photos?limit=1`, { headers: FSQ_HDRS() });
      if(pr.ok){
        const ph = await pr.json();
        const first = Array.isArray(ph) ? ph[0] : ph?.photos?.[0];
        if(first?.prefix) out.photo = first.prefix + '500x300' + first.suffix;
      }
    }catch(e){}
    return out;
  });
}
/* Google photo URLs are minted per request and carry the API key, so resolve
   them server-side with skipHttpRedirect and hand the browser the plain URI. */
const GOOG_DETAIL_MASK = 'id,rating,userRatingCount,priceLevel,editorialSummary,photos';
async function googDetails(id){
  return cached('gdn:' + id, 86400e3, async () => {
    const out = { rating: null, rating5: null, ratingCount: null, price: null, photo: '', blurb: '', src: 'goog' };
    const rr = await fetch(`${GOOG_BASE}/places/${encodeURIComponent(id)}`, {
      headers: { 'X-Goog-Api-Key': GOOG, 'X-Goog-FieldMask': GOOG_DETAIL_MASK } });
    if(!rr.ok) throw new Error('Google Places: ' + await googErr(rr));
    const j = await rr.json();
    out.rating5 = j.rating ?? null;
    out.rating = j.rating != null ? Math.round(j.rating * 20) / 10 : null;
    out.ratingCount = j.userRatingCount ?? null;
    out.price = GOOG_PRICE[j.priceLevel] ?? null;
    out.blurb = j.editorialSummary?.text || '';
    const photo = (j.photos || [])[0];
    if(photo?.name){
      try{
        const pr = await fetch(`${GOOG_BASE}/${photo.name}/media?maxWidthPx=500&skipHttpRedirect=true`,
          { headers: { 'X-Goog-Api-Key': GOOG } });
        if(pr.ok) out.photo = (await pr.json()).photoUri || '';
      }catch(e){}
    }
    return out;
  });
}
app.get('/api/placedetails', async (req, res) => {
  try{
    const src = req.query.src === 'goog' ? 'goog' : 'fsq';
    const id = String(req.query.id || '');
    if(!id) return res.status(400).json({ error: 'id required' });
    if(src === 'goog'){
      if(!GOOG) return res.status(503).json({ error: 'GOOGLE_API_KEY not set' });
      if(!/^[\w-]+$/.test(id)) return res.status(400).json({ error: 'bad id' });
      return res.json(await googDetails(id));
    }
    if(!FSQ) return res.status(503).json({ error: 'FSQ_API_KEY not set' });
    res.json(await fsqDetails(id.replace(/[^\w]/g, '')));
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});
/* legacy path — cached frontends from before the Google split still call this */
app.get('/api/fsqdetails', async (req, res) => {
  try{
    if(!FSQ) return res.status(503).json({ error: 'FSQ_API_KEY not set' });
    const id = String(req.query.id || '').replace(/[^\w]/g, '');
    if(!id) return res.status(400).json({ error: 'id required' });
    res.json(await fsqDetails(id));
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- AI town brief (Anthropic; cached per place per 6 h) ---- */
app.post('/api/brief', express.json({ limit: '200kb' }), async (req, res) => {
  try{
    if(!AI) return res.status(503).json({ error: 'GEMINI_API_KEY not set' });
    const { name = '', country = 'US', data = {} } = req.body || {};
    if(!name) return res.status(400).json({ error: 'name required' });
    const key = 'brief:' + name + ':' + new Date().toISOString().slice(0, 10);
    const text = await cached(key, 6 * 3600e3, async () => {
      const rr = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent?key=${AI}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text:
            'You write compact local-town briefings. Plain text only, no markdown symbols, no preamble.' }] },
          contents: [{ role: 'user', parts: [{ text:
`Write a compact local briefing for ${name} (${country}). Use ONLY the data below. Four short sections titled OVERVIEW, NEWS, COMMUNITY, THIS WEEK, each 2-3 sentences. Lead with any active weather alerts.

DATA:
${JSON.stringify(data).slice(0, 12000)}` }] }],
          generationConfig: { maxOutputTokens: 700 }
        })
      });
      if(!rr.ok) throw new Error('Gemini HTTP ' + rr.status);
      const j = await rr.json();
      return (j.candidates?.[0]?.content?.parts || []).map(pt => pt.text || '').join('').trim();
    });
    res.json({ text });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- NASA EONET natural events (wildfires, storms, volcanoes, floods…) ---- */
app.get('/api/events-natural', async (req, res) => {
  try{
    const data = await cached('eonet:open', 20 * 60e3, async () => {
      const rr = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200');
      if(!rr.ok) throw new Error('EONET HTTP ' + rr.status);
      return rr.json();
    });
    const events = (data.events || []).map(e => {
      const geo = (e.geometry || []).slice(-1)[0];   // most recent position
      if(!geo || !Array.isArray(geo.coordinates)) return null;
      const [lon, lat] = geo.coordinates;
      if(typeof lat !== 'number' || typeof lon !== 'number') return null;
      return {
        id: e.id, title: e.title,
        category: e.categories?.[0]?.title || 'Event',
        cat: e.categories?.[0]?.id || '',
        lat, lon,
        date: geo.date || '',
        url: e.sources?.[0]?.url || (e.link || '')
      };
    }).filter(Boolean);
    res.json({ events });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- nearby webcams (Windy Webcams API v3) ----
   Free-tier image URLs carry tokens that expire in 10 minutes, so the cache
   TTL stays safely under that. */
app.get('/api/webcams', async (req, res) => {
  try{
    if(!WINDY) return res.status(503).json({ error: 'not configured' });
    const { lat, lon } = req.query;
    if(!lat || !lon) return res.status(400).json({ error: 'bad params' });
    const key = `wc:${(+lat).toFixed(2)},${(+lon).toFixed(2)}`;
    const data = await cached(key, 8 * 60e3, async () => {
      const url = 'https://api.windy.com/webcams/api/v3/webcams' +
        `?nearby=${encodeURIComponent(lat)}%2C${encodeURIComponent(lon)}%2C80` +
        '&limit=24&include=images%2Clocation%2Cplayer%2Curls';
      const rr = await fetch(url, { headers: { 'x-windy-api-key': WINDY, Accept: 'application/json' } });
      if(!rr.ok) throw new Error('Windy HTTP ' + rr.status);
      return rr.json();
    });
    const cams = (data.webcams || []).map(w => {
      const pid = w.webcamId || w.id || '';
      const pl = w.player || {};
      // v3 sometimes returns player modes as flags rather than URLs — Windy's
      // embed player URL is deterministic, so build it from the cam id
      const embed = m => pid ? `https://webcams.windy.com/webcams/public/embed/player/${pid}/${m}` : '';
      const asUrl = (v, m) => typeof v === 'string' && v.startsWith('http') ? v : (v ? embed(m) : '');
      return {
        id: pid,
        title: w.title || 'Webcam',
        lat: w.location?.latitude,
        lon: w.location?.longitude,
        city: [w.location?.city, w.location?.region].filter(Boolean).join(', '),
        img: w.images?.current?.preview || w.images?.current?.thumbnail || '',
        page: w.urls?.detail || w.urls?.webcam ||
              (pid ? 'https://www.windy.com/webcams/' + pid : ''),
        playerLive: asUrl(pl.live, 'live'),
        playerDay: asUrl(pl.day, 'day') || asUrl(pl.month, 'month'),
        live: !!pl.live
      };
    }).filter(w => w.img && w.lat != null);
    res.json({ cams });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- radar proxy (RainViewer) — same-origin so filtered networks still work ---- */
app.get('/api/radar/meta', async (req, res) => {
  try{
    const d = await cached('radar:meta', 5 * 60e3, async () => {
      const rr = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if(!rr.ok) throw new Error('RainViewer HTTP ' + rr.status);
      return rr.json();
    });
    res.json(d);
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});
app.get('/api/radar/tile', async (req, res) => {
  try{
    const { p, z, x, y } = req.query;
    if(!/^\/v2\/(radar|nowcast)\/[\w-]+$/.test(String(p))) throw new Error('bad path');
    if(![z, x, y].every(v => /^\d+$/.test(String(v)))) throw new Error('bad coords');
    // free tier: 512px tiles, Universal Blue (2), max zoom 7
    const url = `https://tilecache.rainviewer.com${p}/512/${z}/${x}/${y}/2/1_1.png`;
    const buf = await cached('rt:' + url, 5 * 60e3, async () => {
      const rr = await fetch(url);
      if(!rr.ok) throw new Error('tile HTTP ' + rr.status);
      return Buffer.from(await rr.arrayBuffer());
    });
    res.type('image/png').send(buf);
  }catch(e){ res.status(502).send(''); }
});

/* ---- OpenWeatherMap tile proxy (clouds / temperature; key stays server-side) ---- */
let owmCalls = [];
function owmAllowed(){
  const now = Date.now();
  owmCalls = owmCalls.filter(t => now - t < 60e3);
  if(owmCalls.length >= 50) return false;    // hard ceiling under OWM's 60/min
  owmCalls.push(now);
  return true;
}
app.get('/api/wx-tile', async (req, res) => {
  try{
    if(!OWM) return res.status(503).send('');
    const { layer, z, x, y } = req.query;
    if(!['clouds_new','temp_new','wind_new','pressure_new'].includes(String(layer))) throw new Error('bad layer');
    if(![z, x, y].every(v => /^\d+$/.test(String(v)))) throw new Error('bad coords');
    const url = `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${OWM}`;
    // free-tier data is ~3 h stale anyway, so a 45-min tile cache loses nothing
    const buf = await cached('owm:' + url, 45 * 60e3, async () => {
      if(!owmAllowed()) throw new Error('OWM rate ceiling');
      const rr = await fetch(url);
      if(!rr.ok) throw new Error('OWM HTTP ' + rr.status);
      return Buffer.from(await rr.arrayBuffer());
    });
    res.type('image/png').send(buf);
  }catch(e){ res.status(502).send(''); }
});

/* ---- NASA GIBS tile proxy (satellite true-color, fire hotspots; keyless) ---- */
const GIBS_LAYERS = {
  satellite: { id:'VIIRS_SNPP_CorrectedReflectance_TrueColor', tms:'GoogleMapsCompatible_Level9', ext:'jpg' },
  fires:     { id:'VIIRS_SNPP_Thermal_Anomalies_375m_All',     tms:'GoogleMapsCompatible_Level8', ext:'png' }
};
app.get('/api/gibs-tile', async (req, res) => {
  try{
    const L = GIBS_LAYERS[String(req.query.layer)];
    const { z, x, y } = req.query;
    if(!L) throw new Error('bad layer');
    if(![z, x, y].every(v => /^\d+$/.test(String(v)))) throw new Error('bad coords');
    const mkUrl = t => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${L.id}/default/${t}/${L.tms}/${z}/${y}/${x}.${L.ext}`;
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const buf = await cached('gibs:' + L.id + ':' + z + ':' + y + ':' + x, 30 * 60e3, async () => {
      for(const t of ['default', yesterday]){
        const rr = await fetch(mkUrl(t));
        if(rr.ok) return Buffer.from(await rr.arrayBuffer());
      }
      throw new Error('GIBS unavailable');
    });
    res.type(L.ext === 'jpg' ? 'image/jpeg' : 'image/png').send(buf);
  }catch(e){ res.status(502).send(''); }
});

/* ---- layer diagnostics: fetches one sample tile per provider, reports upstream status ---- */
app.get('/api/layer-test', async (req, res) => {
  const out = {};
  const probe = async (name, url, opts) => {
    try{
      const rr = await fetch(url, opts);
      out[name] = { status: rr.status, type: rr.headers.get('content-type') };
    }catch(e){ out[name] = { error: String(e.message || e) }; }
  };
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await Promise.all([
    probe('gibs_satellite_default', 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/default/GoogleMapsCompatible_Level9/4/5/4.jpg'),
    probe('gibs_satellite_dated', `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${yesterday}/GoogleMapsCompatible_Level9/4/5/4.jpg`),
    probe('gibs_fires', `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_All/default/${yesterday}/GoogleMapsCompatible_Level8/4/5/4.png`),
    OWM ? probe('owm_clouds', `https://tile.openweathermap.org/map/clouds_new/4/4/5.png?appid=${OWM}`) : Promise.resolve(out.owm_clouds = { error: 'no key' }),
    FSQ ? probe('fsq_search', `${FSQ_BASE}/places/search?ll=42.33%2C-83.05&radius=1000&limit=1`, { headers: FSQ_HDRS() }) : Promise.resolve(out.fsq_search = { error: 'no key' }),
    GOOG ? probe('google_search', `${GOOG_BASE}/places:searchNearby`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOG, 'X-Goog-FieldMask': 'places.id,places.displayName' },
      body: JSON.stringify({ includedTypes: ['restaurant'], maxResultCount: 1,
        locationRestriction: { circle: { center: { latitude: 42.33, longitude: -83.05 }, radius: 1000 } } })
    }) : Promise.resolve(out.google_search = { error: 'no key' }),
    probe('rainviewer_meta', 'https://api.rainviewer.com/public/weather-maps.json')
  ]);
  res.json(out);
});

/* ---- detour: telling "two miles away" from "two miles away across a river" ----
   A radius search draws a circle, and a circle does not know about water. From
   Edgewater NJ a four-mile circle is mostly Manhattan: the Kids tab came back
   57 New York entries to 3 New Jersey ones, all of them a bridge and a toll
   away. Filtering by state was the obvious fix and the wrong one — Monroe MI
   to Toledo OH and Cherry Hill NJ to Philadelphia are both cross-state and
   both perfectly normal drives.

   What separates them is whether the road goes the way the crow flies. Measured
   against the POIs that actually appear in that Edgewater search:

     across the Hudson   ratio 2.45 – 5.02   (+3.7 to +6.3 miles)
     same side           ratio 1.26 – 1.86   (+1.1 to +2.1 miles)
     Monroe -> Toledo    ratio 1.13
     Cherry Hill -> Philly ratio 1.11

   Nothing overlaps, so the threshold sits in the gap. Note this only holds at
   the radii where the problem bites: over a longer trip a bridge amortises
   away, which is why Oakland to San Francisco is 1.38 and will not be flagged.

   Routed one town at a time rather than one POI at a time — the client groups
   results by locality and sends centroids — so a busy search costs eight or so
   requests, and then none, because road networks do not move and these cache
   for a month. */
const OSRM = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
const DETOUR_TTL = 30 * 86400e3;

/* The demo server is a courtesy, not a product: no SLA, no key, and a request
   rate we are asked to keep sane. One at a time, one per second, everything
   cached hard, and a deadline so a slow upstream degrades to "no chip" rather
   than to a hung panel. */
let osrmChain = Promise.resolve();
const osrmQueue = fn => (osrmChain = osrmChain.then(
  () => new Promise(r => setTimeout(r, 1000)).then(fn, fn)));

const miles = (a, b, c, d) => {
  const R = 3958.8, t = x => x * Math.PI / 180;
  const h = Math.sin(t(c - a) / 2) ** 2 +
            Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// ~0.01 deg is about half a mile: precise enough to route, coarse enough that
// two visitors to the same town share a cache entry
const cell = n => (Math.round(n * 100) / 100).toFixed(2);

async function driveMiles(oLat, oLon, pLat, pLon){
  const key = `detour:${cell(oLat)},${cell(oLon)}:${cell(pLat)},${cell(pLon)}`;
  return cached(key, DETOUR_TTL, () => osrmQueue(async () => {
    const url = `${OSRM}/route/v1/driving/${oLon},${oLat};${pLon},${pLat}?overview=false&alternatives=false`;
    const r = await withDeadline(fetch(url), 6000, 'OSRM');
    if(!r.ok) throw new Error('OSRM HTTP ' + r.status);
    const j = await r.json();
    const m = j?.routes?.[0]?.distance;
    if(!Number.isFinite(m)) throw new Error('OSRM returned no route');
    return m / 1609.34;
  }));
}

app.post('/api/detour', express.json({ limit: '8kb' }), async (req, res) => {
  try{
    const { origin, points } = req.body || {};
    if(!origin || !Number.isFinite(+origin.lat) || !Number.isFinite(+origin.lon))
      return res.status(400).json({ error: 'origin {lat, lon} required' });
    const list = (Array.isArray(points) ? points : []).slice(0, 12)
      .filter(p => p && p.key && Number.isFinite(+p.lat) && Number.isFinite(+p.lon));

    /* Whole-request deadline. The client asks for every town it found and
       applies whatever comes back — a partial answer filters the towns it
       covers and leaves the rest visible, which is the safe direction to
       fail. */
    const until = Date.now() + 9000;
    const out = {};
    for(const p of list){
      if(Date.now() > until) break;
      const crow = miles(+origin.lat, +origin.lon, +p.lat, +p.lon);
      if(crow < 0.3){ out[p.key] = { crow, drive: crow, ratio: 1 }; continue; }
      try{
        const drive = await driveMiles(+origin.lat, +origin.lon, +p.lat, +p.lon);
        out[p.key] = { crow: +crow.toFixed(2), drive: +drive.toFixed(2),
                       ratio: +(drive / crow).toFixed(2) };
      }catch(e){ /* unroutable or upstream down — that town stays unflagged */ }
    }
    res.json({ items: out, attribution: 'OSRM · © OpenStreetMap contributors' });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* ---- CALL-E: "Ask the Place" first-party FAQs ----
   Thin wiring only; the call script, guardrails, budget and storage live in
   calle.js. Calls are async: ask-place returns a call id, the answer lands
   by webhook, and /api/ask-place/:id is the polling fallback. */
const calle = require('./calle');
const auth = require('./auth');

/* ---- accounts ----
   attachUser is mounted per-route rather than app-wide on purpose: it can cost
   a round-trip to Supabase, and the map, the tiles and every listing endpoint
   have no idea who you are and no reason to find out. Only the routes below
   care. See auth.js for why identity is Supabase's and data is not. */

app.get('/api/auth/me', auth.attachUser, async (req, res) => {
  if(!req.user) return res.json({ user: null, prefs: null });
  try{
    res.json({ user: req.user, prefs: await auth.getPrefs(req.user.id) });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* Tab visibility. Which tabs a given account shows is the whole per-user
   feature-flag story today — it exists so a demo can be one clean tab instead
   of eighteen, and so anyone can turn off the parts of this app they never
   open. Nothing here gates a paid or private feature: those are decided
   server-side by requireUser, never by what the client was told to draw. */
app.get('/api/auth/prefs', auth.attachUser, auth.requireUser, async (req, res) => {
  try{ res.json(await auth.getPrefs(req.user.id)); }
  catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

app.put('/api/auth/prefs', express.json({ limit: '4kb' }), auth.attachUser, auth.requireUser,
  async (req, res) => {
    try{ res.json(await auth.setPrefs(req.user.id, req.body || {})); }
    catch(e){ res.status(502).json({ error: String(e.message || e) }); }
  });

/* ---- delete an account ----
   The counterpart to the privacy notice. Each module deletes what it owns —
   auth.js its preferences and token cache, calle.js its private results, locks
   and call records — and the reply reports counts rather than just "ok", because
   a deletion the user cannot see the shape of is a promise, not a receipt.

   Public verified facts are untouched and the reply says so: they carry no
   account id, so there is nothing in one to identify who asked, and they belong
   to the place and every later visitor rather than to the person whose question
   started the call.

   The identity row goes last. If Supabase refuses, this answers 502 with the
   reason and admits our records are already gone — claiming success over a live
   account would be the worst outcome available here. */
app.delete('/api/auth/account', auth.attachUser, auth.requireUser, async (req, res) => {
  const uid = req.user.id;
  try{
    const mine = await auth.forgetAccount(uid, auth.bearer(req));
    const calls = await calle.forgetUser(uid);
    const deleted = { ...mine, privateResults: calls.private, callRecords: calls.calls,
                      locks: calls.locks };

    /* A reviewer's account is this process's own fixture, not a row in anybody's
       identity provider, so there is nothing further to delete. */
    if(auth.REVIEW_MODE && uid === 'review-mode-local')
      return res.json({ ok: true, deleted, identity: 'review-mode fixture; nothing to delete',
                        publicFactsKept: true });

    const gone = await auth.deleteSupabaseUser(auth.bearer(req));
    if(!gone.ok)
      return res.status(502).json({ ok: false, deleted, publicFactsKept: true,
        error: 'Your stored data has been deleted, but the sign-in record could not be: '
             + gone.reason + '. Nothing was lost — try again, or the data is already gone and only the login remains.' });

    res.json({ ok: true, deleted, publicFactsKept: true });
  }catch(e){
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

/* One account's private call results for one place. */
app.post('/api/private-faq', express.json({ limit: '8kb' }), auth.attachUser, auth.requireUser,
  async (req, res) => {
    try{
      const p = req.body || {};
      if(!p.name) return res.status(400).json({ error: 'place required' });
      res.json({ items: await calle.getPrivate(req.user.id, p) });
    }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
  });

/* CALL-E throws a typed CalleAPIError carrying `code`, `status` and `details`,
   and those are the fields that say *why*. Collapsing them to e.message loses
   the actionable part: "goal_not_executable" points at a specific fix, while
   the sentence it ships with does not. Pass the code through, and preserve the
   upstream status so a 4xx does not get reported as our 502. */
function calleErrBody(e){
  const body = { error: String(e && e.message || e) };
  if(e && e.code) body.code = e.code;
  if(e && e.details && Object.keys(e.details).length) body.details = e.details;
  return body;
}
const calleErrStatus = e =>
  (e && Number.isInteger(e.status) && e.status >= 400 && e.status < 600) ? e.status : 502;

/* ---- the number has to come from the listing, not from the request ----
   `place` arrives in the request body, and until now every field in it was
   taken at face value — including the number to dial. The UI only ever sends
   back a listing it was shown, but the UI is not the gate: an account holder
   who also has the real-call access code could post any `place` they liked,
   with `openNow: true` and `confirmed: true`, and have this app ring a number of
   their choosing while presenting itself as calling on behalf of a visitor.

   That also quietly falsified the one sentence the safety notes lean on — that
   the app "only ever dials a number published on a place listing it is already
   showing" — which is the reason given for not carrying an emergency-number
   block. A claim that only the client enforces is not a property of the system.

   So the server looks the number up again itself, by the provider id the
   listing carries, and dials what the provider says rather than what the caller
   sent. Cached for a day: this is the same lookup the details panel already
   makes, and a business's number is not news. */
const GOOG_PHONE_MASK = 'id,nationalPhoneNumber,internationalPhoneNumber';
async function listedPhone(place){
  const gid = String((place && place.gid) || '');
  const fsqId = String((place && place.fsqId) || '');
  try{
    if(gid && GOOG) return await cached('lp:g:' + gid, 86400e3, async () => {
      const rr = await fetch(`${GOOG_BASE}/places/${encodeURIComponent(gid)}`,
        { headers: { 'X-Goog-Api-Key': GOOG, 'X-Goog-FieldMask': GOOG_PHONE_MASK } });
      if(!rr.ok) throw new Error('Google Places: ' + await googErr(rr));
      const j = await rr.json();
      return j.nationalPhoneNumber || j.internationalPhoneNumber || '';
    });
    if(fsqId && FSQ) return await cached('lp:f:' + fsqId, 86400e3, async () => {
      const rr = await fetch(`${FSQ_BASE}/places/${encodeURIComponent(fsqId)}?fields=tel`,
        { headers: FSQ_HDRS() });
      if(!rr.ok) throw new Error('FSQ ' + rr.status);
      return (await rr.json()).tel || '';
    });
  }catch(e){
    /* A lookup that fails is not a lookup that succeeded. Returning null sends
       this down the unverified path, where a live call is refused. */
    console.warn('listedPhone failed:', String(e.message || e));
    return null;
  }
  return null;                       // no provider id: nothing to check against
}

/* Set on the server, always, so a `listedPhone` invented by a caller cannot
   survive the spread and be mistaken for one we looked up. */
const withListedPhone = async place => ({ ...place, listedPhone: await listedPhone(place) });

/* Every path through here can spend a CALL-E credit, so every path through
   here needs a name attached — that is the whole reason this app grew accounts.
   Note that requireUser sits in front of *both* kinds of ask: a new verified
   fact and a private action cost the same credit, and reading an answer someone
   already collected still costs nothing and still needs nobody. */
app.post('/api/ask-place', express.json({ limit: '8kb' }), auth.attachUser, auth.requireUser,
  async (req, res) => {
    try{
      const { place, question, templateId, confirmed, force, isPrivate } = req.body || {};
      if(!place || !place.name || place.lat == null || place.lon == null)
        return res.status(400).json({ error: 'place {name, lat, lon, phone} required' });
      const r = await calle.askPlace({ place: await withListedPhone(place), question, templateId,
        confirmed: confirmed === true, force: force === true,
        isPrivate: isPrivate === true, uid: req.user.id,
        accessCode: req.get('x-atlas-access') || '' });
      res.status(r.status || 200).json(r);
    }catch(e){ res.status(calleErrStatus(e)).json(calleErrBody(e)); }
  });

/* One question, two or three places, one CALL-E task with several recipients —
   see the round section in calle.js. requireUser for the same reason a private
   ask has it, and more so: a round has no public form at all, so a round
   without an owner is a record nobody could ever read.

   There is deliberately no polling route of its own. A round is polled through
   /api/ask-place/:id like everything else, because pollCall routes on the
   stored request rather than on which URL the client happened to use. */
app.post('/api/ask-around', express.json({ limit: '16kb' }), auth.attachUser, auth.requireUser,
  async (req, res) => {
    try{
      const { places, question, templateId, confirmed } = req.body || {};
      if(!Array.isArray(places) || !places.length)
        return res.status(400).json({ error: 'places[] required' });
      if(places.some(p => !p || !p.name || p.lat == null || p.lon == null))
        return res.status(400).json({ error: 'each place needs {name, lat, lon, phone}' });
      const r = await calle.askAround({ places: await Promise.all(places.map(withListedPhone)),
        question, templateId,
        confirmed: confirmed === true,
        uid: req.user.id, accessCode: req.get('x-atlas-access') || '' });
      res.status(r.status || 200).json(r);
    }catch(e){ res.status(calleErrStatus(e)).json(calleErrBody(e)); }
  });

/* Every round this account has run. Not per-place, because a round is not about
   one place — it is the one record here that belongs to the question rather
   than to any listing. */
app.get('/api/rounds', auth.attachUser, auth.requireUser, async (req, res) => {
  try{ res.json({ items: await calle.getRounds(req.user.id) }); }
  catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* Lets the unlock form tell a wrong code from a working one without having to
   start a call to find out. Reveals only whether the code unlocks anything —
   and on a deploy that will simulate regardless (dry run, no key, an unpinned
   origin) the answer is no, because accepting a code there would promise a real
   call the server has already decided not to place. */
app.post('/api/ask-access', express.json({ limit: '2kb' }), (req, res) => {
  res.json({ ok: calle.realCallsPossible() && calle.realCallOk((req.body || {}).code || '') });
});

/* Question chips for one place: Gemini's place-specific suggestions first, then
   the fixed templates. POST because it takes the place object, and because the
   suggestions are per-place rather than per-category and so aren't cacheable. */
app.post('/api/ask-suggestions', express.json({ limit: '4kb' }), async (req, res) => {
  try{
    const { place, category } = req.body || {};
    res.json({ items: await calle.suggestQuestions(place || {}, String(category || '')) });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* Operator view of one place: every stored call including the transcripts that
   no longer go to the public panel. Behind the real-call code. */
app.post('/api/calle/calls', express.json({ limit: '8kb' }), async (req, res) => {
  try{
    if(!calle.realCallOk(req.get('x-atlas-access') || ''))
      return res.status(401).json({ error: 'access code required' });
    const p = req.body || {};
    if(!p.name) return res.status(400).json({ error: 'place required' });
    res.json({ items: await calle.listCalls(p) });
  }catch(e){ res.status(calleErrStatus(e)).json(calleErrBody(e)); }
});

/* Polling stays open to anonymous callers — a public call in flight is nobody's
   secret — but the uid is passed through so pollCall can refuse to hand a
   private result to anyone but its owner. */
app.get('/api/ask-place/:id', auth.attachUser, async (req, res) => {
  try{
    const id = String(req.params.id || '');
    if(!/^call_[\w-]+$/.test(id)) return res.status(400).json({ error: 'bad call id' });
    const r = await calle.pollCall(id, req.user ? req.user.id : '');
    res.status(r.status || 200).json(r);
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

app.post('/api/place-faq', express.json({ limit: '8kb' }), async (req, res) => {
  try{
    const p = req.body || {};
    if(!p.name) return res.status(400).json({ error: 'place required' });
    res.json({ items: await calle.getFaq(p) });
  }catch(e){ res.status(502).json({ error: String(e.message || e) }); }
});

/* Unsigned delivery — the token in the path is the only thing separating this
   from an open endpoint, and the body is re-verified against the API inside. */
app.post('/api/calle/webhook/:token', express.json({ limit: '256kb' }), async (req, res) => {
  try{
    const r = await calle.handleWebhook({ token: req.params.token, body: req.body });
    res.status(r.status || 200).json({ ok: r.status === 200, ...(r.error ? { error: r.error } : {}) });
  }catch(e){
    // 200 anyway: CALL-E retries on non-2xx, and a poisoned record would just
    // fail again. The poll fallback still recovers the result.
    console.error('calle webhook:', e.message);
    res.status(200).json({ ok: false });
  }
});

app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const SELF = (process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
if(SELF){
  setInterval(() => { fetch(SELF + '/api/health').catch(()=>{}); }, 10 * 60e3);
  console.log('keep-alive: pinging ' + SELF + ' every 10 min');
  const warm = () => ['/api/states/visit', '/api/states/weird', '/api/states/events']
    .forEach((ep, i) => setTimeout(() => fetch(SELF + ep).catch(()=>{}), i * 30e3));
  setTimeout(warm, 30e3);                 // warm shortly after boot
  setInterval(warm, 6 * 3600e3);          // and keep the daily caches fresh
  // one-time pre-warm of all 50 state law sets (cached ~forever via Redis)
  if(AI) STATES.forEach(([name], i) =>
    setTimeout(() => fetch(SELF + '/api/laws?scope=state&place=' + encodeURIComponent(name)).catch(()=>{}), 120e3 + i * 4000));
}
app.listen(PORT, () => console.log('local-atlas listening on :' + PORT));
