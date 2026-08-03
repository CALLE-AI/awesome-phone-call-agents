/**
 * Baseline storage.
 *
 * Plain JSON files under the configured baseline directory: one history file
 * per check plus `lines.json` for ownership verifications. Files, not a
 * database, so the state can live in a repo, an Actions cache or a volume,
 * and a human can read what the canary saw.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckOutcome } from "./assert.js";

const HISTORY_CAP = 50;

export interface LineVerification {
  lineId: string;
  phone: string;
  method: string;
  verifiedAt: string;
  callId: string | null;
}

export interface BaselineStore {
  history(checkId: string): CheckOutcome[];
  append(outcome: CheckOutcome): void;
  verification(lineId: string): LineVerification | null;
  recordVerification(verification: LineVerification): void;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Check ids come from validated config, but stay defensive about paths. */
function historyFile(dir: string, checkId: string): string {
  return join(dir, `${checkId.replaceAll(/[^A-Za-z0-9_-]/g, "_")}.history.json`);
}

export function openStore(dir: string): BaselineStore {
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
      writeFileSync(path, JSON.stringify(history.slice(-HISTORY_CAP), null, 2));
    },
    verification(lineId) {
      const verifications = readJson<Record<string, LineVerification>>(linesFile, {});
      return verifications[lineId] ?? null;
    },
    recordVerification(verification) {
      const verifications = readJson<Record<string, LineVerification>>(linesFile, {});
      verifications[verification.lineId] = verification;
      writeFileSync(linesFile, JSON.stringify(verifications, null, 2));
    },
  };
}
