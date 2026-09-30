/**
 * PUBLICATION — a delta, never an overwrite.
 *
 * A verified call does not write into the directory. It produces a proposed
 * changeset row carrying (field, old, new, evidence, confidence, verified_at).
 * A human approves or rejects each row. Approved rows append to a per-field
 * history; nothing is ever destroyed, and every historical value keeps the
 * evidence that produced it.
 *
 * Freshness is modelled explicitly, because a verified fact is not verified
 * forever: freshness(t) = exp(-age / tau_field), with the same tau priors the
 * risk model uses. A field verified today is already only ~64% fresh tomorrow
 * if it is `capacity_status`.
 */

import { TAU_DAYS } from './risk.js';
import { valuesEqual } from './extract.js';
import { REVIEW_THRESHOLD } from './extract.js';

/* ------------------------------------------------------ canonicalising --- */

const NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** Turns any of the 8 published hour formats into HH:00-HH:00. */
export function canonicalizeHours(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw);
  const mil = /\b(\d{3,4})\s*-\s*(\d{3,4})\b/.exec(str);
  if (mil) {
    const o = Math.floor(parseInt(mil[1], 10) / 100);
    const c = Math.floor(parseInt(mil[2], 10) / 100);
    if (o < 24 && c < 24 && c > o) return `${String(o).padStart(2, '0')}:00-${String(c).padStart(2, '0')}:00`;
  }
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi;
  const found = [];
  let m;
  while ((m = re.exec(str)) !== null) {
    const h = m[1] ? parseInt(m[1], 10) : NUM_WORD[m[4].toLowerCase()];
    if (h === undefined || h > 23) continue;
    found.push({ h, mer: m[3] ? m[3].toLowerCase().replace(/\./g, '') : null });
  }
  if (found.length < 2) return null;
  let open = found[0].h;
  let close = found[1].h;
  if (found[0].mer === 'pm' && open < 12) open += 12;
  if (found[1].mer === 'pm' && close < 12) close += 12;
  else if (found[1].mer === 'am') {
    /* explicitly morning */
  } else if (close <= 12 && close + 12 > open) close += 12;
  if (close <= open) return null;
  return `${String(open).padStart(2, '0')}:00-${String(close).padStart(2, '0')}:00`;
}

export function canonicalizePet(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toLowerCase();
  if (/no pets|no animals/.test(s)) return 'no_pets';
  if (/crat/.test(s)) return 'crated_pets_only';
  if (/service animals|svc animals/.test(s)) return 'service_animals_only';
  if (/pets ok|pets welcome|pet friendly|pets_allowed/.test(s)) return 'pets_allowed';
  return s;
}

/** One canonical form per field so published, extracted and truth are comparable. */
export function canonicalize(field, value) {
  if (value === null || value === undefined) return null;
  if (field === 'hours') return canonicalizeHours(value);
  if (field === 'pet_policy') return canonicalizePet(value);
  if (field === 'open_now') return value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
  return String(value);
}

/* ----------------------------------------------------------- routing ----- */

export const ROUTE = {
  AUTO: 'auto_publishable',
  REVIEW: 'needs_review',
  NONE: 'no_change_proposed',
};

/**
 * Build the changeset for one facility from its merged extractions.
 * Nothing here writes to the directory.
 */
export function buildChangeset(facility, extractions, callMeta, nowIso) {
  const rows = [];
  for (const ex of extractions) {
    const published = facility.fields[ex.field];
    const oldCanon = canonicalize(ex.field, published?.value ?? null);

    if (ex.value === 'unknown') {
      rows.push({
        facilityId: facility.id,
        facilityName: facility.name,
        field: ex.field,
        oldValue: published?.value ?? null,
        oldCanonical: oldCanon,
        newValue: 'unknown',
        newCanonical: null,
        evidence: null,
        confidence: 0,
        verifiedAt: null,
        status: 'unknown',
        route: ROUTE.NONE,
        reason: ex.reason,
        callMeta,
      });
      continue;
    }

    const newCanon = canonicalize(ex.field, ex.value);
    const same = oldCanon !== null && valuesEqual(oldCanon, newCanon);
    const status = oldCanon === null ? 'filled' : same ? 'confirmed' : 'changed';

    let route;
    let reason;
    if (ex.confidence < REVIEW_THRESHOLD) {
      route = ROUTE.REVIEW;
      reason = `confidence ${ex.confidence.toFixed(2)} below ${REVIEW_THRESHOLD} threshold${ex.hedged ? ' (speaker hedged)' : ''}`;
    } else if (ex.internalConflict) {
      route = ROUTE.REVIEW;
      reason = `attempts disagreed: "${ex.value}" vs "${ex.internalConflict.otherValue}"`;
    } else if (status === 'changed') {
      route = ROUTE.REVIEW;
      reason = `contradicts published record (${String(oldCanon)} -> ${String(newCanon)})`;
    } else {
      route = ROUTE.AUTO;
      reason = status === 'filled' ? 'fills a blank field, no contradiction' : 'confirms published value';
    }

    rows.push({
      facilityId: facility.id,
      facilityName: facility.name,
      field: ex.field,
      oldValue: published?.value ?? null,
      oldCanonical: oldCanon,
      newValue: ex.value,
      newCanonical: newCanon,
      evidence: {
        quote: ex.quote,
        contextQuote: ex.contextQuote,
        span: ex.span,
        turnIndex: ex.span.turnIndex,
        channel: ex.channel,
        attempt: ex.attemptIndex ?? callMeta.attemptUsed,
        outcome: callMeta.outcome,
      },
      confidence: ex.confidence,
      hedged: ex.hedged,
      verifiedAt: nowIso,
      status,
      route,
      reason,
      callMeta,
    });
  }
  return rows;
}

/** THE PUBLICATION GATE. Refuses to publish anything without a transcript span. */
export function assertPublishable(rows) {
  const violations = [];
  for (const r of rows) {
    if (r.newValue === 'unknown') {
      violations.push({ row: r, why: 'unknown value reached the publication gate' });
      continue;
    }
    const sp = r.evidence?.span;
    if (!r.evidence || !sp || typeof sp.start !== 'number' || typeof sp.end !== 'number' || sp.end <= sp.start) {
      violations.push({ row: r, why: 'no transcript span' });
    }
    if (!r.evidence?.quote || String(r.evidence.quote).length === 0) {
      violations.push({ row: r, why: 'empty evidence quote' });
    }
  }
  if (violations.length) {
    throw new Error(
      `CITATION_RULE_VIOLATION: ${violations.length} row(s) reached publication without evidence: ` +
        violations.slice(0, 3).map((v) => `${v.row.facilityId}/${v.row.field} (${v.why})`).join('; '),
    );
  }
  return { checked: rows.length, violations: 0 };
}

/**
 * Verifies the citation span actually points at text supporting the value —
 * not just that a span object exists. A span that does not resolve inside its
 * transcript is treated as a violation.
 */
export function verifySpansResolve(rows, transcriptsByCallId) {
  let resolved = 0;
  const failures = [];
  for (const r of rows) {
    const tx = transcriptsByCallId.get(`${r.callMeta.callId}#${r.evidence.attempt}`);
    if (!tx) {
      failures.push(`${r.facilityId}/${r.field}: transcript missing`);
      continue;
    }
    const slice = tx.text.slice(r.evidence.span.start, r.evidence.span.end);
    if (slice.length > 0 && slice === r.evidence.quote) resolved++;
    else failures.push(`${r.facilityId}/${r.field}: span text "${slice}" != quote "${r.evidence.quote}"`);
  }
  return { total: rows.length, resolved, failures };
}

/* ---------------------------------------------------------- freshness ---- */

export function freshness(field, verifiedAtIso, nowMs) {
  if (!verifiedAtIso) return 0;
  const age = Math.max(0, (nowMs - Date.parse(verifiedAtIso)) / 86400000);
  return Math.exp(-age / TAU_DAYS[field]);
}

/** Days until a freshly-verified field decays below `floor` (default 50%). */
export function halfLifeDays(field, floor = 0.5) {
  return TAU_DAYS[field] * Math.log(1 / floor);
}

/* ------------------------------------------------------------ history ---- */

export class DirectoryStore {
  constructor(facilities) {
    this.facilities = new Map(facilities.map((f) => [f.id, f]));
    /** key `${facilityId}:${field}` -> array of versions, oldest first */
    this.history = new Map();
    for (const f of facilities) {
      for (const [field, v] of Object.entries(f.fields)) {
        this.history.set(`${f.id}:${field}`, [
          {
            value: v.value,
            canonical: canonicalize(field, v.value),
            verifiedAt: v.last_verified,
            source: v.source,
            evidence: null,
            approvedBy: null,
          },
        ]);
      }
    }
    this.published = [];
    this.rejected = [];
  }

  /** Apply an approved changeset row. Appends; never overwrites. */
  approve(row, approver = 'operator@county') {
    assertPublishable([row]);
    const key = `${row.facilityId}:${row.field}`;
    const versions = this.history.get(key) ?? [];
    versions.push({
      value: row.newValue,
      canonical: row.newCanonical,
      verifiedAt: row.verifiedAt,
      source: 'simulated_phone_verification',
      evidence: row.evidence,
      confidence: row.confidence,
      approvedBy: approver,
      status: row.status,
    });
    this.history.set(key, versions);
    this.published.push({ ...row, approvedBy: approver, approvedAt: new Date().toISOString() });
    return row;
  }

  reject(row, approver = 'operator@county', note = 'rejected in review') {
    this.rejected.push({ ...row, rejectedBy: approver, note });
  }

  currentValue(facilityId, field) {
    const v = this.history.get(`${facilityId}:${field}`);
    return v ? v[v.length - 1] : null;
  }

  versionCount(facilityId, field) {
    return (this.history.get(`${facilityId}:${field}`) ?? []).length;
  }
}

export { REVIEW_THRESHOLD };
