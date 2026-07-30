/**
 * The coordination ledger.
 *
 * Every call, every narrowing of the feasible set, the commit decision and every
 * release call is appended as one JSON line. The point is not that a log exists.
 * The point is `replay`, which walks the recorded answers and recomputes the
 * feasible set, the chosen slot and the outcome. If the ledger says Thursday but
 * the recorded answers do not intersect on Thursday, replay says so.
 */

import { appendFileSync, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { chooseSlot, intersect } from "./slots.js";
import { saidYes } from "./window.js";
import type {
  CommitResult,
  CoordinationRequest,
  LedgerEntry,
  Outcome,
  ReplayIssue,
  ReplayVerification,
  Slot,
} from "./types.js";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function digestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function requestDigest(request: CoordinationRequest): string {
  return digestOf({
    meeting: request.meeting,
    slots: request.slots.map((slot) => ({ id: slot.id, start: slot.start })),
    parties: request.parties.map((party) => party.id),
    policy: request.policy,
  });
}

export function appendEntry(path: string, entry: LedgerEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

export class LedgerLockError extends Error {}

export interface LedgerLock {
  path: string;
  release: () => void;
}

/**
 * One writer per ledger.
 *
 * The idempotency key is what stops two runs dialling the same person twice: it
 * is the reservation and it lives at CALL-E, not here. This lock is narrower and
 * local. It stops two processes interleaving lines into one ledger file, which
 * would leave a history that replays as nonsense. The lock is created with
 * `O_EXCL`, so the create either wins or fails.
 */
export function acquireLedgerLock(path: string): LedgerLock {
  const lockPath = `${path}.lock`;
  let handle: number;
  try {
    handle = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    let holder = "";
    try {
      holder = ` Held by ${readFileSync(lockPath, "utf8").trim()}.`;
    } catch {
      holder = "";
    }
    throw new LedgerLockError(
      `Another run holds ${path}.${holder} Wait for it to finish or delete ${lockPath} if that process is gone.`,
    );
  }
  writeSync(handle, `pid ${process.pid} since ${new Date().toISOString()}`);
  closeSync(handle);
  return {
    path: lockPath,
    release: () => {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    },
  };
}

export function readEntries(path: string): LedgerEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LedgerEntry);
}

function ids(slots: Slot[]): string[] {
  return slots.map((slot) => slot.id);
}

/**
 * Recompute the whole run from the recorded answers.
 *
 * This is the check a plain log cannot do. It re-derives the feasible set after
 * every gather call, the slot that choice implies and whether the recorded
 * outcome follows from the confirm and release calls.
 *
 * A ledger can hold more than one round. A crashed or canceled run is picked up
 * by `resume`, which opens a `resume_started` entry and closes with a fresh
 * outcome, so replay folds every round in order and reports the last outcome.
 * Entries after an outcome that no `resume_started` opened are a problem.
 */
export function replay(entries: LedgerEntry[]): ReplayVerification {
  const issues: ReplayIssue[] = [];
  const started = entries.find((entry) => entry.kind === "run_started");
  if (started === undefined || started.kind !== "run_started") {
    return { ok: false, entries: entries.length, outcome: null, issues: [{ entry: 0, problem: "no run_started entry" }] };
  }
  const slots = started.slots;
  const parties = started.parties;

  let feasible: Slot[] = slots;
  let index = 0;
  let calls = 0;
  const credited = new Map<string, boolean>();
  const spokenYes: string[] = [];
  const released: string[] = [];
  let chosen: string | null = null;
  let outcome: Outcome | null = null;
  let closed = false;

  /**
   * Read one confirm result.
   *
   * Credit is the ledger's last word on that call, so a later entry settling the
   * same call replaces it. A yes recorded outside the window is not credit at all
   * and a ledger that claims otherwise is reported. The debt only grows: once
   * somebody has said yes on a call they have to be told when it is off, whatever
   * a later entry says.
   */
  const readConfirm = (at: number, result: CommitResult): void => {
    if (result.confirmed && result.within_window === false) {
      issues.push({
        entry: at,
        problem: `${result.party_id} is credited with a confirmation that landed outside the window this run could act on`,
      });
    }
    credited.set(result.party_id, result.confirmed && result.within_window !== false);
    if (saidYes(result) && !spokenYes.includes(result.party_id)) {
      spokenYes.push(result.party_id);
    }
  };

  for (const entry of entries) {
    index += 1;
    if (closed && entry.kind !== "resume_started") {
      issues.push({
        entry: index,
        problem: `${entry.kind} follows outcome ${String(outcome)} with no resume_started entry opening a new round`,
      });
    }
    if (entry.kind === "resume_started") {
      closed = false;
    }
    if (entry.kind === "gather") {
      calls += 1;
      if (canonicalJson(entry.feasible_before) !== canonicalJson(ids(feasible))) {
        issues.push({ entry: index, problem: `feasible_before ${entry.feasible_before.join(",")} does not match the run so far (${ids(feasible).join(",")})` });
      }
      const expected = entry.result.reached_person
        ? intersect(feasible, entry.result.available_options)
        : [];
      if (canonicalJson(entry.feasible_after) !== canonicalJson(ids(expected))) {
        issues.push({
          entry: index,
          problem: `feasible_after ${entry.feasible_after.join(",") || "empty"} does not follow from ${entry.result.party_id}'s recorded answer (${ids(expected).join(",") || "empty"})`,
        });
      }
      feasible = slots.filter((slot) => entry.feasible_after.includes(slot.id));
    }
    if (entry.kind === "slot_chosen") {
      const expected = chooseSlot(feasible);
      if (expected === null || expected.id !== entry.slot_id) {
        issues.push({
          entry: index,
          problem: `slot ${entry.slot_id} is not the earliest slot the recorded answers leave (${expected?.id ?? "none"})`,
        });
      }
      chosen = entry.slot_id;
    }
    if (entry.kind === "commit") {
      calls += 1;
      if (chosen !== null && entry.result.slot_id !== chosen) {
        issues.push({ entry: index, problem: `confirm call for ${entry.result.party_id} names slot ${entry.result.slot_id}, not the chosen ${chosen}` });
      }
      readConfirm(index, entry.result);
    }
    if (entry.kind === "reconcile") {
      // Looking a call up by its idempotency key places no call. Only a
      // reconciliation that had to create the call counts against the budget.
      if (entry.placed_call) {
        calls += 1;
      }
      if (entry.result.phase === "confirm") {
        readConfirm(index, entry.result);
      }
      if (entry.result.phase === "release" && entry.result.acknowledged) {
        released.push(entry.result.party_id);
      }
    }
    if (entry.kind === "release") {
      calls += 1;
      // A call that ended is not a call that told somebody. Only acknowledged
      // delivery counts here, so a ledger cannot close a debt with a release
      // call that reached a machine or failed.
      if (entry.result.acknowledged) {
        released.push(entry.result.party_id);
      }
    }
    if (entry.kind === "outcome") {
      if (entry.calls_placed !== calls) {
        issues.push({ entry: index, problem: `calls_placed ${entry.calls_placed} does not match the ${calls} call entries in this ledger` });
      }
      if (entry.outcome === "verbally_confirmed") {
        const missing = parties.filter((party) => credited.get(party) !== true);
        if (missing.length > 0) {
          issues.push({ entry: index, problem: `verbally_confirmed, but ${missing.join(", ")} never confirmed` });
        }
        if (entry.slot_id !== chosen) {
          issues.push({ entry: index, problem: `confirmed slot ${String(entry.slot_id)} is not the chosen slot ${String(chosen)}` });
        }
      } else {
        // Nothing is going ahead, so everybody who said yes on a call has to have
        // been told or named as still owed a call. That includes a yes the run
        // refused to act on: the person still heard themselves agree to a time.
        const owed = spokenYes.filter(
          (party) => !released.includes(party) && !entry.unreleased.includes(party),
        );
        if (owed.length > 0) {
          issues.push({
            entry: index,
            problem: `${owed.join(", ")} confirmed and were never released or listed as unreleased`,
          });
        }
      }
      if (entry.outcome === "no_common_slot" && chosen !== null) {
        issues.push({ entry: index, problem: "no_common_slot, but a slot was chosen" });
      }
      outcome = entry.outcome;
      closed = true;
    }
  }

  if (outcome === null) {
    issues.push({ entry: index, problem: "no outcome entry, the run did not finish" });
    return { ok: false, entries: entries.length, outcome: null, issues };
  }
  return { ok: issues.length === 0, entries: entries.length, outcome, issues };
}

export function replayFile(path: string): ReplayVerification {
  return replay(readEntries(path));
}
