#!/usr/bin/env node
/**
 * Generates the two committed data files:
 *   app/data/directory.json     - the "published" county directory, with real-world mess
 *   app/data/ground-truth.json  - what is ACTUALLY true today at each facility, plus the
 *                                 phone-line behaviour the simulator will play back.
 *
 * Deterministic: fixed seed, so regenerating produces byte-identical output.
 * Run:  node app/tools/generate-directory.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '..', 'data');

/* ---------------------------------------------------------------- rng ---- */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x0ca11e);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/* ------------------------------------------------------------- corpus ---- */
const NOW = new Date('2026-08-26T09:00:00-07:00');
const iso = (d) => new Date(d).toISOString();
const daysAgo = (n) => iso(NOW.getTime() - n * 86400000);

const KINDS = [
  { kind: 'library_cooling_center', vuln: 1.0, label: 'Library Cooling Center' },
  { kind: 'community_center', vuln: 1.05, label: 'Community Center' },
  { kind: 'overnight_respite', vuln: 1.3, label: 'Overnight Heat Respite' },
  { kind: 'hydration_station', vuln: 0.78, label: 'Hydration Station' },
  { kind: 'faith_based_relief', vuln: 1.12, label: 'Faith-Based Relief Site' },
  { kind: 'senior_center', vuln: 1.22, label: 'Senior Center' },
  { kind: 'mobile_unit', vuln: 0.9, label: 'Mobile Relief Unit' },
  { kind: 'municipal_office', vuln: 0.85, label: 'Municipal Lobby Site' },
];

const STREETS = [
  'W Van Buren St', 'E Roosevelt St', 'N Central Ave', 'S 7th Ave', 'W Indian School Rd',
  'E Thomas Rd', 'N 51st Ave', 'W Camelback Rd', 'S Mill Ave', 'E Broadway Rd',
  'N Scottsdale Rd', 'W Peoria Ave', 'E Baseline Rd', 'N 35th Ave', 'W Bethany Home Rd',
  'S Country Club Dr', 'E Guadalupe Rd', 'N 19th Ave', 'W Dunlap Ave', 'E McDowell Rd',
];
const CITIES = [
  ['Phoenix', '850'], ['Mesa', '852'], ['Glendale', '853'], ['Tempe', '852'],
  ['Chandler', '852'], ['Peoria', '853'], ['Surprise', '853'], ['Avondale', '853'],
  ['Scottsdale', '852'], ['Gilbert', '852'],
];
const NAME_A = [
  'Sunnyslope', 'Maryvale', 'Encanto', 'Desert Vista', 'Ocotillo', 'Papago', 'South Mountain',
  'Cave Creek', 'Estrella', 'Palo Verde', 'Camelback East', 'Deer Valley', 'Laveen',
  'Ahwatukee', 'Verrado', 'Agua Fria', 'Copper Sky', 'Red Mountain', 'Dobson Ranch',
  'Val Vista', 'Arrowhead', 'Litchfield', 'Roosevelt Row', 'Grant Park', 'Coronado',
  'Garfield', 'Eastlake', 'Alhambra', 'North Gateway', 'Rio Vista', 'Tolleson',
  'Sun City', 'Youngtown', 'El Mirage', 'Guadalupe', 'Buckeye', 'Anthem', 'Cactus Park',
  'Harmon', 'Yucca', 'Ironwood', 'Saguaro', 'Mesquite', 'Chaparral', 'Pinnacle Peak',
  'Thunderbird', 'Bell Road', 'Greenway', 'Union Hills', 'Shea', 'Lone Butte',
  'Sossaman', 'Higley', 'Recker', 'Signal Butte', 'Crismon', 'Elliot', 'Warner',
  'Ray Road', 'Chandler Heights',
];
const OPERATORS = [
  'Maricopa County Human Services', 'City of Phoenix Parks & Rec', 'Salvation Army Valley Corps',
  'St. Vincent de Paul', 'Phoenix Public Library', 'Mesa Community Services',
  'Glendale Neighborhood Services', 'Tempe Community Action Agency', 'Lutheran Social Services SW',
  'Central Arizona Shelter Services', 'Chicanos Por La Causa', 'Society of St. Vincent',
  'Valley of the Sun United Way', 'Native Health Phoenix', 'Justa Center',
];

/* ------- messy published hour strings: 8 different formats on purpose ----- */
const HOUR_FORMATS = [
  (o, c) => `${o}am-${c}pm`,
  (o, c) => `${o}:00 AM – ${c}:00 PM`,
  (o, c) => `M-F ${o}-${c}`,
  (o, c) => `Mon thru Fri, ${o} a.m. to ${c} p.m.`,
  (o, c) => `${o}00-${c + 12}00`,
  (o, c) => `Daily ${o}AM to ${c}PM`,
  (o, c) => `Open ${o}:00-${c + 12}:00 (closed holidays)`,
  (o, c) => `${o} am - ${c} pm, weekdays only`,
];
const canonicalHours = (o, c) => `${String(o).padStart(2, '0')}:00-${String(c + 12).padStart(2, '0')}:00`;

const PET_VALUES = ['pets_allowed', 'service_animals_only', 'crated_pets_only', 'no_pets'];
const PET_PUBLISHED_TEXT = {
  pets_allowed: ['Pets OK', 'pets welcome', 'Pet friendly'],
  service_animals_only: ['Service animals only', 'ADA service animals only', 'svc animals only'],
  crated_pets_only: ['Crated pets only', 'pets must be crated'],
  no_pets: ['No pets', 'no animals permitted'],
};
const ACCESS_VALUES = ['fully_accessible', 'ramp_only', 'not_accessible'];
const INTAKE_VALUES = ['no_id_required', 'id_requested_not_required', 'photo_id_required', 'referral_required'];
const CAPACITY_VALUES = ['space_available', 'near_capacity', 'at_capacity'];

const PERSONAS = [
  'knowledgeable_manager',
  'front_desk_unsure',
  'new_volunteer',
  'terse_maintenance',
  'bilingual_handoff',
];

/* -------------------------------------------------------------- build ---- */
const facilities = [];
const truth = [];
let dupSourceIdx = -1;

for (let i = 0; i < 60; i++) {
  const id = `MC-${String(1001 + i)}`;
  const kindDef = KINDS[i % KINDS.length];
  const nameA = NAME_A[i % NAME_A.length];
  const [city, zip3] = CITIES[i % CITIES.length];
  const name = `${nameA} ${kindDef.label}`;
  const operator = OPERATORS[i % OPERATORS.length];

  /* ---- phone: several kinds of broken ---- */
  let phoneRaw = null;
  let lineType = 'main';
  const roll = rnd();
  if (roll < 0.05) {
    phoneRaw = null; // no number published at all
    lineType = 'none';
  } else if (roll < 0.10) {
    phoneRaw = `(${int(602, 623)}) 555-0${int(100, 199)}`;
    lineType = 'disconnected';
  } else if (roll < 0.16) {
    phoneRaw = `${int(602, 623)}-555-${int(1000, 1999)} ext ${int(2, 9)}${int(10, 99)}`;
    lineType = 'ivr';
  } else if (roll < 0.24) {
    phoneRaw = `+1 ${int(602, 623)} 555 ${int(1000, 1999)}`;
    lineType = 'mobile';
  } else if (roll < 0.30) {
    phoneRaw = `${int(602, 623)}.555.${int(1000, 1999)}`;
    lineType = 'main';
  } else {
    phoneRaw = `(${int(602, 623)}) 555-${int(1000, 1999)}`;
    lineType = chance(0.18) ? 'ivr' : 'main';
  }

  /* ---- address: some PO boxes, some incomplete ---- */
  let address;
  if (chance(0.08)) {
    address = `PO Box ${int(1000, 9999)}, ${city}, AZ ${zip3}${int(10, 99)}`;
  } else if (chance(0.06)) {
    address = `${city}, AZ`; // street missing entirely
  } else {
    address = `${int(100, 9999)} ${STREETS[i % STREETS.length]}, ${city}, AZ ${zip3}${int(10, 99)}`;
  }

  /* ---- ground truth for today ---- */
  const tOpenHour = int(7, 10);
  const tCloseHour = int(4, 9); // pm
  const t = {
    open_now: chance(0.78),
    hours: canonicalHours(tOpenHour, tCloseHour),
    pet_policy: pick(PET_VALUES),
    accessibility: pick(ACCESS_VALUES),
    intake_requirements: pick(INTAKE_VALUES),
    capacity_status: pick(CAPACITY_VALUES),
  };

  /* ---- published record: drifted from truth, with gaps ---- */
  const pubOpenHour = chance(0.72) ? tOpenHour : Math.max(6, tOpenHour + (chance(0.5) ? -1 : 1));
  const pubCloseHour = chance(0.68) ? tCloseHour : Math.min(11, tCloseHour + (chance(0.5) ? -1 : 2));
  const fmt = HOUR_FORMATS[i % HOUR_FORMATS.length];

  const mkField = (value, tauDays, opts = {}) => {
    const age = opts.age ?? int(3, 210);
    return {
      value,
      last_verified: value === null ? null : daysAgo(age),
      source: opts.source ?? pick(['county_pdf', 'self_reported', 'partner_import', 'phone_2025']),
    };
  };

  const petTrue = t.pet_policy;
  const petPub = chance(0.7) ? petTrue : pick(PET_VALUES);
  const accPub = chance(0.82) ? t.accessibility : pick(ACCESS_VALUES);
  const intakePub = chance(0.7) ? t.intake_requirements : pick(INTAKE_VALUES);
  const capPub = chance(0.4) ? t.capacity_status : pick(CAPACITY_VALUES);

  const fields = {
    open_now: mkField(chance(0.9) ? true : false, 1.5, { age: int(1, 95) }),
    hours: chance(0.9)
      ? mkField(fmt(pubOpenHour, pubCloseHour), 45, { age: int(10, 400) })
      : mkField(null, 45),
    pet_policy: chance(0.82)
      ? mkField(pick(PET_PUBLISHED_TEXT[petPub]), 140, { age: int(30, 500) })
      : mkField(null, 140),
    accessibility: chance(0.75) ? mkField(accPub, 300, { age: int(60, 700) }) : mkField(null, 300),
    intake_requirements: chance(0.66)
      ? mkField(intakePub, 90, { age: int(20, 420) })
      : mkField(null, 90),
    capacity_status: chance(0.45) ? mkField(capPub, 2, { age: int(1, 60) }) : mkField(null, 2),
  };

  const record = {
    id,
    name,
    operator,
    kind: kindDef.kind,
    kind_label: kindDef.label,
    vulnerability_weight: kindDef.vuln,
    address,
    address_is_po_box: address.startsWith('PO Box'),
    phone: phoneRaw,
    est_daily_visitors: int(18, 340),
    seasonal_activation_flag: pick(['activated', 'activated', 'standby', 'unknown', 'activated']),
    source_document: `Maricopa County Heat Relief Network directory, rev ${pick(['2026-05-30', '2026-06-14', '2026-04-02'])}`,
    duplicate_of: null,
    fields,
  };

  facilities.push(record);
  // Reachability is a property of the facility, not of luck. Some sites simply
  // do not pick up the phone on a 112F afternoon, and no retry policy fixes that.
  const reachRoll = rnd();
  const reachability = reachRoll < 0.1 ? 'unreachable_today' : reachRoll < 0.26 ? 'hard' : 'normal';

  truth.push({
    id,
    line_type: lineType,
    reachability,
    persona: pick(PERSONAS),
    answer_delay_ms: int(220, 900),
    truth: t,
    // per-field willingness of THIS facility's staff to answer on the phone
    knows: {
      open_now: true,
      hours: chance(0.95),
      pet_policy: chance(0.8),
      accessibility: chance(0.7),
      intake_requirements: chance(0.78),
      capacity_status: chance(0.74),
    },
  });

  if (dupSourceIdx < 0 && i > 12) dupSourceIdx = i;
}

/* ---- inject 4 duplicate listings (same phone, slightly different name) ---- */
const dupTargets = [7, 19, 31, 44];
dupTargets.forEach((srcIdx, k) => {
  const src = facilities[srcIdx];
  const dupId = `MC-9${String(101 + k)}`;
  const dup = JSON.parse(JSON.stringify(src));
  dup.id = dupId;
  dup.name = `${src.name.split(' ').slice(0, 2).join(' ')} Cooling Site (legacy listing)`;
  dup.operator = '211 Arizona import';
  dup.duplicate_of = src.id;
  dup.source_document = '211 Arizona partner feed, rev 2026-03-11';
  // legacy listings are staler and lose fields
  dup.fields.capacity_status = { value: null, last_verified: null, source: 'partner_import' };
  dup.fields.accessibility = { value: null, last_verified: null, source: 'partner_import' };
  dup.fields.open_now = {
    value: true,
    last_verified: daysAgo(int(120, 330)),
    source: 'partner_import',
  };
  facilities.push(dup);
  const srcTruth = truth[srcIdx];
  truth.push({
    id: dupId,
    line_type: srcTruth.line_type,
    reachability: srcTruth.reachability,
    persona: srcTruth.persona,
    answer_delay_ms: srcTruth.answer_delay_ms,
    truth: srcTruth.truth,
    knows: srcTruth.knows,
    shares_line_with: src.id,
  });
});

/* ---- a couple of stale activation flags that are provably wrong today ---- */
facilities[3].seasonal_activation_flag = 'activated';
truth[3].truth.open_now = false;
facilities[3].fields.open_now.value = true;
facilities[3].fields.open_now.last_verified = daysAgo(88);

facilities[22].seasonal_activation_flag = 'standby';
truth[22].truth.open_now = true;

mkdirSync(DATA, { recursive: true });

writeFileSync(
  resolve(DATA, 'directory.json'),
  JSON.stringify(
    {
      dataset: 'Simulated Maricopa County Heat Relief Network directory',
      note: 'Synthetic. Names, addresses and 555-prefixed numbers are fictional. Modeled on the shape and failure modes of real published county heat-relief directories.',
      generated_at: iso(NOW),
      as_of: iso(NOW),
      field_schema: [
        'open_now',
        'hours',
        'pet_policy',
        'accessibility',
        'intake_requirements',
        'capacity_status',
      ],
      facilities,
    },
    null,
    1,
  ) + '\n',
);

writeFileSync(
  resolve(DATA, 'ground-truth.json'),
  JSON.stringify(
    {
      note: 'Ground truth for the DETERMINISTIC SIMULATED FACILITY transport. Used only by the simulator and by the evaluation panel. Never used by the planner or the extractor.',
      generated_at: iso(NOW),
      facilities: truth,
    },
    null,
    1,
  ) + '\n',
);

const lineCounts = truth.reduce((a, t) => ((a[t.line_type] = (a[t.line_type] || 0) + 1), a), {});
console.log(`facilities: ${facilities.length}`);
console.log(`duplicates: ${facilities.filter((f) => f.duplicate_of).length}`);
console.log(`po boxes:   ${facilities.filter((f) => f.address_is_po_box).length}`);
console.log(`no phone:   ${facilities.filter((f) => !f.phone).length}`);
console.log('lines:', lineCounts);
const missing = {};
for (const f of facilities)
  for (const [k, v] of Object.entries(f.fields)) if (v.value === null) missing[k] = (missing[k] || 0) + 1;
console.log('missing published values:', missing);
