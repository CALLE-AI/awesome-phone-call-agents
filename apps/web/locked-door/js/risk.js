/**
 * THE RISK MODEL — "which facts matter today"
 *
 * Every (facility, field) pair is scored on three independent axes and the
 * product is an *expected harm reduction in units of harm*:
 *
 *     EHR(f, k) = harm_if_stale(f, k) x P(stale | k, age, source) x P(observable by phone | k, line)
 *
 * All three terms are defined here with their priors written down, because a
 * risk model whose constants live in someone's head is not a risk model.
 */

/* -------------------------------------------------------- HARM PRIORS ---- */
/**
 * harm_if_stale: what happens to a person who acts on this field when it is wrong.
 * Anchored at 1.0 = "arrives at a locked door during an excessive-heat warning".
 */
export const HARM_BASE = {
  open_now: 1.0, // locked door in 112F. the whole reason this product exists
  hours: 0.82, // arrives 40 minutes after close
  accessibility: 0.7, // wheelchair user cannot get in and has no fallback
  capacity_status: 0.6, // turned away at the door, must travel again
  intake_requirements: 0.55, // has no photo ID, is refused, will not come back
  pet_policy: 0.45, // will not abandon a dog, so stays outside in the heat
};

/* --------------------------------------------------- VOLATILITY PRIORS --- */
/**
 * Mean life of a fact, in days, before it should be assumed stale.
 * P(stale) = 1 - exp(-age_days / tau). These are the load-bearing assumptions:
 *
 *  open_now (1.5d)            activation flips with each heat advisory
 *  capacity_status (2.0d)     changes within a single day; nearly always stale
 *  hours (45d)                seasonal + staffing changes
 *  intake_requirements (90d)  policy changes at the program level
 *  pet_policy (140d)          changes rarely, usually after an incident
 *  accessibility (300d)       changes only with construction
 */
export const TAU_DAYS = {
  open_now: 1.5,
  capacity_status: 2.0,
  hours: 45,
  intake_requirements: 90,
  pet_policy: 140,
  accessibility: 300,
};

/** Source credibility multiplier on P(stale). Self-reported rots faster. */
export const SOURCE_STALENESS_MULT = {
  county_pdf: 1.0,
  phone_2025: 0.85, // last verified by a human on the phone: decays slower
  self_reported: 1.25,
  partner_import: 1.4, // 211 feed of a feed
};

/* ------------------------------------------------- OBSERVABILITY PRIORS -- */
/**
 * P(a phone call to this facility yields a groundable answer for this field).
 * Front-desk staff reliably know if they are open; almost nobody can speak to
 * ADA compliance without checking.
 */
export const OBSERVABILITY = {
  open_now: 0.95,
  hours: 0.92,
  pet_policy: 0.75,
  intake_requirements: 0.7,
  accessibility: 0.6,
  capacity_status: 0.55,
};

/**
 * Line profile, keyed on what the PUBLISHED RECORD reveals — not on what the
 * line actually is. The planner cannot know a number is disconnected until it
 * is dialed, and modelling it as if it could would quietly inflate every result
 * on this page. All the planner sees is: is there a number, and does it look
 * like a direct line or a switchboard extension.
 */
export const LINE_PROFILE = {
  direct: { observability: 1.0, connect: 0.72 },
  switchboard: { observability: 0.85, connect: 0.55 },
  none: { observability: 0.0, connect: 0.0 },
};

/** Derived from the directory record alone. Ground truth is not consulted. */
export function publishedLineClass(facility) {
  if (!facility.phone) return 'none';
  if (/\bext\b|\bx\d/i.test(facility.phone)) return 'switchboard';
  return 'direct';
}

export const FIELDS = Object.keys(HARM_BASE);

/* ------------------------------------------------------------- model ---- */

export function ageDays(lastVerifiedIso, nowMs) {
  if (!lastVerifiedIso) return null;
  return Math.max(0, (nowMs - Date.parse(lastVerifiedIso)) / 86400000);
}

/**
 * P(this published value no longer matches reality).
 * A missing value is not "fresh" — it is maximally unknown, so it gets a high
 * fixed prior rather than being skipped.
 */
export function probabilityStale(field, published, nowMs) {
  if (!published || published.value === null || published.value === undefined) {
    return { p: 0.88, reason: 'no published value', age: null };
  }
  const age = ageDays(published.last_verified, nowMs);
  if (age === null) return { p: 0.88, reason: 'no verification timestamp', age: null };
  const tau = TAU_DAYS[field];
  const mult = SOURCE_STALENESS_MULT[published.source] ?? 1.0;
  const raw = 1 - Math.exp(-age / tau);
  const p = Math.min(0.97, raw * mult);
  return { p, reason: `${age.toFixed(0)}d old / tau ${tau}d / src x${mult}`, age };
}

/**
 * harm_if_stale scaled by who actually shows up at this facility.
 * A 300-visitor overnight respite site is not the same bet as a 20-visitor
 * hydration cart, and pretending otherwise is how directories get triaged badly.
 */
export function harmIfStale(field, facility) {
  const base = HARM_BASE[field];
  const vuln = facility.vulnerability_weight ?? 1.0;
  // log-scaled exposure so a 340-visitor site is ~1.6x a 20-visitor site, not 17x
  const exposure = 0.6 + 0.4 * (Math.log10(Math.max(10, facility.est_daily_visitors)) / Math.log10(340));
  // an "unknown" or "standby" activation flag makes open_now far more dangerous
  let flagBump = 1.0;
  if (field === 'open_now') {
    if (facility.seasonal_activation_flag === 'unknown') flagBump = 1.35;
    else if (facility.seasonal_activation_flag === 'standby') flagBump = 1.2;
  }
  return base * vuln * exposure * flagBump;
}

export function observability(field, lineType) {
  const prof = LINE_PROFILE[lineType] ?? LINE_PROFILE.main;
  return OBSERVABILITY[field] * prof.observability;
}

/** Score every (facility, field) pair. Returns a flat, sortable list. */
export function scoreDirectory(facilities, lineClassById, nowMs) {
  const rows = [];
  for (const f of facilities) {
    const line = lineClassById(f.id);
    for (const field of FIELDS) {
      const published = f.fields[field];
      const stale = probabilityStale(field, published, nowMs);
      const harm = harmIfStale(field, f);
      const obs = observability(field, line);
      rows.push({
        facilityId: f.id,
        field,
        harm,
        pStale: stale.p,
        staleReason: stale.reason,
        ageDays: stale.age,
        observability: obs,
        ehr: harm * stale.p * obs,
        publishedValue: published?.value ?? null,
      });
    }
  }
  return rows;
}
