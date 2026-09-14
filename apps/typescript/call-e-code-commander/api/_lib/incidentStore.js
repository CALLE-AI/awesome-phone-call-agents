/**
 * Server-side record of what each incident call ended up deciding.
 *
 * The browser polls a live call because it is the thing on screen. That is fine
 * while somebody is watching, and useless the moment they are not. A laptop lid
 * closes, a tab is discarded on a phone, a train goes into a tunnel, and the
 * ladder that was mid-escalation stops existing. For a tool whose whole job is
 * to run at 3am, "it works while you watch it" is not a property worth having.
 *
 * So terminal call outcomes are written here by the webhook receiver, keyed by
 * the incident id carried in call metadata, and the page reads them back when it
 * returns. Nothing here is authoritative on its own: the receiver writes only
 * what it re-read from the CALL-E API with the server key.
 *
 * Durability is deliberately pluggable and deliberately honest about itself.
 * With a file path it survives a restart, which is what makes the local demo
 * survive a closed tab. Without one it lives in the process, which on a
 * serverless host means it survives only while that instance stays warm. A real
 * deployment points this at a database, and `describeDurability` says which of
 * the three is in force rather than letting a reader assume the best one.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Incidents retained before the oldest is dropped. */
const MAX_INCIDENTS = 50;

/** Webhook event ids remembered for deduplication. */
const MAX_EVENT_IDS = 500;

export class IncidentStore {
  /**
   * @param {object} [options]
   * @param {string|null} [options.filePath] Where to persist, or null for memory only.
   */
  constructor(options = {}) {
    this.filePath = options.filePath || null;
    this.state = { incidents: {}, eventIds: [] };
    this.load();
  }

  /** True when this store outlives the process that created it. */
  get isPersistent() {
    return Boolean(this.filePath);
  }

  describeDurability() {
    return this.filePath
      ? `File-backed at ${this.filePath}. Outcomes survive a restart and a closed browser tab.`
      : 'In-process only. Outcomes survive while this instance stays warm, and are lost when it is recycled. Point CALLE_INCIDENT_STORE_PATH at a writable file, or replace this store with a database, for anything beyond a demo.';
  }

  load() {
    if (!this.filePath) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.state = {
          incidents: parsed.incidents || {},
          eventIds: Array.isArray(parsed.eventIds) ? parsed.eventIds : []
        };
      }
    } catch {
      // A missing or unreadable file is an empty store, not an error. The store
      // is a convenience over polling, so failing to read it must never stop a
      // call being placed.
    }
  }

  save() {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      // Same reasoning as load: a store that cannot write is degraded, not fatal.
    }
  }

  /**
   * Records a terminal call outcome against its incident.
   *
   * Writes are idempotent per call id, because the same webhook event can be
   * delivered more than once and a duplicate must not append a second rung to
   * the audit trail.
   *
   * @param {string} incidentId
   * @param {object} record Already verified against the CALL-E API.
   */
  recordCall(incidentId, record) {
    if (!incidentId || !record?.callId) return null;

    const incident = this.state.incidents[incidentId] || {
      incidentId,
      firstSeenAt: new Date().toISOString(),
      calls: []
    };

    const existing = incident.calls.findIndex((call) => call.callId === record.callId);
    if (existing >= 0) {
      incident.calls[existing] = { ...incident.calls[existing], ...record };
    } else {
      incident.calls.push(record);
    }

    incident.updatedAt = new Date().toISOString();
    this.state.incidents[incidentId] = incident;
    this.prune();
    this.save();
    return incident;
  }

  /** @returns {object|null} Everything recorded for one incident. */
  get(incidentId) {
    return this.state.incidents[incidentId] || null;
  }

  /**
   * Marks a webhook event id as processed.
   *
   * CALL-E documents the event id as the value to store before side effects so
   * duplicate deliveries can be ignored, which is exactly what this is for.
   *
   * @returns {boolean} False when this event was already seen.
   */
  claimEvent(eventId) {
    if (!eventId) return true;
    if (this.state.eventIds.includes(eventId)) return false;
    this.state.eventIds.push(eventId);
    if (this.state.eventIds.length > MAX_EVENT_IDS) {
      this.state.eventIds = this.state.eventIds.slice(-MAX_EVENT_IDS);
    }
    this.save();
    return true;
  }

  prune() {
    const ids = Object.keys(this.state.incidents);
    if (ids.length <= MAX_INCIDENTS) return;
    const ordered = ids
      .map((id) => ({ id, at: this.state.incidents[id].updatedAt || this.state.incidents[id].firstSeenAt || '' }))
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const { id } of ordered.slice(0, ids.length - MAX_INCIDENTS)) {
      delete this.state.incidents[id];
    }
  }
}

/** Shared instance, so the webhook receiver and the read endpoint see one store. */
let shared = null;

export function getIncidentStore(env = {}) {
  if (!shared) {
    shared = new IncidentStore({ filePath: env.CALLE_INCIDENT_STORE_PATH || null });
  }
  return shared;
}

/** Test seam. Drops the shared instance so a test can build its own. */
export function resetIncidentStore() {
  shared = null;
}
