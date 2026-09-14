/**
 * Baseline storage.
 *
 * Plain JSON files under the configured baseline directory: one history file
 * per check plus `lines.json` for ownership verifications. Files, not a
 * database, so the state can live in a repo, an Actions cache or a volume,
 * and a human can read what the canary saw.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckOutcome } from "./assert.js";

const DEFAULT_HISTORY_CAP = 200;

export interface LineVerification {
  lineId: string;
  phone: string;
  method: string;
  verifiedAt: string;
  callId: string | null;
}

export interface IncidentNote {
  checkId: string;
  /** The call the note explains — shown only while this is the latest run. */
  callId: string;
  at: string;
  markdown: string;
}

/**
 * A call attempt whose result was never recorded: the create was ambiguous
 * (timeout, 5xx, lost response) or the poll timed out after a successful
 * create. Persisted so the NEXT run reconciles it — reusing the same
 * idempotency key, or polling the known call id — instead of dialing the
 * line again.
 */
export interface PendingAttempt {
  checkId: string;
  idempotencyKey: string;
  /** Known once the create returned an id; null when the create itself was ambiguous. */
  callId: string | null;
  at: string;
}

export interface BaselineStore {
  history(checkId: string): CheckOutcome[];
  append(outcome: CheckOutcome): void;
  verification(lineId: string): LineVerification | null;
  recordVerification(verification: LineVerification): void;
  note(checkId: string): IncidentNote | null;
  recordNote(note: IncidentNote): void;
  pending(checkId: string): PendingAttempt | null;
  recordPending(attempt: PendingAttempt): void;
  clearPending(checkId: string): void;
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    // A corrupt state file must not silently become an empty history — that
    // resets baselines and uptime. Quarantine it loudly and start fresh.
    const quarantine = `${path}.corrupt-${Date.now()}`;
    renameSync(path, quarantine);
    process.stderr.write(`Corrupt state file quarantined: ${path} -> ${quarantine} (${String(error)})\n`);
    return fallback;
  }
}

/** Check ids come from validated config, but stay defensive about paths. */
function slug(checkId: string): string {
  return checkId.replaceAll(/[^A-Za-z0-9_-]/g, "_");
}

function historyFile(dir: string, checkId: string): string {
  return join(dir, `${slug(checkId)}.history.json`);
}

export function openStore(dir: string, historyCap: number = DEFAULT_HISTORY_CAP): BaselineStore {
  mkdirSync(dir, { recursive: true });
  const linesFile = join(dir, "lines.json");

  return {
    history(checkId) {
      return readJson<CheckOutcome[]>(historyFile(dir, checkId), []);
    },
    append(outcome) {
      const path = historyFile(dir, outcome.checkId);
      const history = readJson<CheckOutcome[]>(path, []);
      history.push(outcome);
      writeFileSync(path, JSON.stringify(history.slice(-historyCap), null, 2));
    },
    verification(lineId) {
      const verifications = Object.assign(Object.create(null) as Record<string, LineVerification>, readJson<Record<string, LineVerification>>(linesFile, {}));
      return verifications[lineId] ?? null;
    },
    note(checkId) {
      return readJson<IncidentNote | null>(join(dir, `${checkId.replaceAll(/[^A-Za-z0-9_-]/g, "_")}.note.json`), null);
    },
    recordNote(note) {
      writeFileSync(join(dir, `${note.checkId.replaceAll(/[^A-Za-z0-9_-]/g, "_")}.note.json`), JSON.stringify(note, null, 2));
    },
    recordVerification(verification) {
      // Null-prototype map: a line id of "__proto__" must be an ordinary key,
      // not a call to the prototype setter that would silently drop the record.
      const verifications = Object.assign(Object.create(null) as Record<string, LineVerification>, readJson<Record<string, LineVerification>>(linesFile, {}));
      verifications[verification.lineId] = verification;
      writeFileSync(linesFile, JSON.stringify(verifications, null, 2));
    },
    pending(checkId) {
      return readJson<PendingAttempt | null>(join(dir, `${slug(checkId)}.pending.json`), null);
    },
    recordPending(attempt) {
      writeFileSync(join(dir, `${slug(attempt.checkId)}.pending.json`), JSON.stringify(attempt, null, 2));
    },
    clearPending(checkId) {
      rmSync(join(dir, `${slug(checkId)}.pending.json`), { force: true });
    },
  };
}
