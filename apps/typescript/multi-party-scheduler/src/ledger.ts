/**
 * The coordination ledger.
 *
 * Every call, every narrowing of the feasible set, the commit decision and every
 * release call is appended as one JSON line. The point is not that a log exists.
 * The point is `replay`, which walks the recorded answers and recomputes the
 * feasible set, the chosen slot and the outcome. If the ledger says Thursday but
 * the recorded answers do not intersect on Thursday, replay says so.
 */

import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
  truncateSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { UNRESOLVED_STATUS } from "./call-state.js";
import { chooseSlot, intersect } from "./slots.js";
import { saidYes } from "./window.js";
import type {
  CommitResult,
  CoordinationRequest,
  LedgerEntry,
  Outcome,
  Phase,
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

/**
 * What a resume is allowed to assume has not changed.
 *
 * The whole request goes in, because an unresolved create with no call id is
 * later rebuilt from the request in hand and anything that moves the payload
 * moves the idempotency key with it. This function used to name the fields to
 * bind and every version of that list left something out: first the party
 * fields, then `requestId`, which is the first thing every key is built from and
 * is in the metadata of every call. A list has to be right forever, so there is
 * no list. A field added to `CoordinationRequest` is bound the day it is added,
 * and the cost of forgetting one is a refused resume rather than a second call
 * to somebody who may already have one live.
 *
 * `startMs` and `spoken` are bound too, though both are computed from `start`,
 * `option` and the meeting timezone. `spoken` is rendered by the runtime's own
 * locale data rather than by this app, so it is not a function of the request
 * alone: a resume under a runtime that renders it differently would build a
 * different task text and a different key. Binding it makes that a refusal.
 */
export function requestDigest(request: CoordinationRequest): string {
  return digestOf(request);
}

export class LedgerError extends Error {}
export class LedgerLockError extends LedgerError {}

/** A ledger holds masked numbers, call ids and answers. Only its owner reads it. */
export const LEDGER_MODE = 0o600;

/**
 * Append one entry, with the mode enforced on the way in.
 *
 * A mode handed to `open` only applies when `open` creates the file, so a ledger
 * that already exists keeps whatever mode it had. Documenting 0600 while
 * leaving a 0644 file alone is a claim the code does not keep. Every append opens
 * the file and chmods the descriptor, which is the same file the write goes to, so
 * there is no window between the check and the write for a path to be swapped. A
 * target that is not a regular file is refused rather than written to: a ledger is
 * a file, not a pipe into somebody else's process.
 */
export function appendEntry(path: string, entry: LedgerEntry): void {
  const handle = openSync(path, "a", LEDGER_MODE);
  try {
    const stats = fstatSync(handle);
    if (!stats.isFile()) {
      throw new LedgerError(`${path} is not a regular file, so it is not a ledger this app will write to.`);
    }
    if ((stats.mode & 0o777) !== LEDGER_MODE) {
      fchmodSync(handle, LEDGER_MODE);
    }
    writeSync(handle, `${JSON.stringify(entry)}\n`);
  } finally {
    closeSync(handle);
  }
}

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
    handle = openSync(lockPath, "wx", LEDGER_MODE);
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
  // The lock names the process holding the ledger, so it gets the same mode as the
  // ledger. O_EXCL created it, so this cannot be somebody else's file.
  fchmodSync(handle, LEDGER_MODE);
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

export interface LedgerRead {
  entries: LedgerEntry[];
  /**
   * True when the last line is not a whole entry, which is what a crash between
   * the write and the newline leaves. It is dropped rather than guessed at.
   */
  truncatedTail: boolean;
}

/**
 * Read a ledger.
 *
 * A line that is not an entry is a broken history and it is reported, with one
 * exception: the last line. A crash mid append leaves half an entry there, that
 * record never landed. Refusing to read the rest would mean refusing to
 * recover exactly the run that needs recovering.
 */
export function readLedger(path: string): LedgerRead {
  if (!existsSync(path)) {
    return { entries: [], truncatedTail: false };
  }
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const entries: LedgerEntry[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      entries.push(JSON.parse(line) as LedgerEntry);
    } catch (error) {
      if (index === lines.length - 1) {
        return { entries, truncatedTail: true };
      }
      throw new LedgerError(
        `${path} line ${index + 1} is not a ledger entry: ${(error as Error).message}`,
      );
    }
  }
  return { entries, truncatedTail: false };
}

export function readEntries(path: string): LedgerEntry[] {
  return readLedger(path).entries;
}

/**
 * Drop a torn last line so the file can be appended to again.
 *
 * Half an entry records nothing that replays. Leaving it in place would put a
 * broken line in the middle of the history the moment anything else is appended.
 * Only `resume` calls this. It runs under the ledger lock and says so in its note.
 * Returns whether anything was dropped.
 */
export function repairTornTail(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  const buffer = readFileSync(path);
  const last = buffer.toString("utf8").split("\n").at(-1) ?? "";
  if (last.trim().length === 0) {
    return false;
  }
  try {
    JSON.parse(last);
    return false;
  } catch {
    truncateSync(path, buffer.length - Buffer.byteLength(last, "utf8"));
    return true;
  }
}

function ids(slots: Slot[]): string[] {
  return slots.map((slot) => slot.id);
}

/** A call the ledger records as attempted and never accounts for. */
export interface OpenAttempt {
  /** Line number of the attempt record, 1 based, so a replay issue can name it. */
  entry: number;
  phase: Phase;
  party_id: string;
  phone_masked: string;
  slot_id: string | null;
  idempotency_key: string;
  /** The accepted call id when the create got that far. Null when it did not. */
  call_id: string | null;
}

/**
 * Every attempt with no result behind it.
 *
 * `placeCall` writes a `call_attempt` before the create and a `call_accepted` the
 * moment CALL-E returns an id, so a process death between provider acceptance and
 * the phase entry leaves the key on disk, usually with the call id. This finds the
 * attempts that were left that way: no entry carries the key and no entry records
 * that party and phase at all.
 *
 * A phase entry naming a different key still counts as the result of that call. A
 * key that does not match is a ledger somebody rewrote, not a call nobody can
 * account for. Treating it as open would send recovery after a call whose fate the
 * history already states.
 *
 * Replay and recovery both read this, so the two cannot drift apart on which calls
 * are unaccounted for.
 */
export function openAttempts(entries: LedgerEntry[]): OpenAttempt[] {
  const attempts = new Map<string, OpenAttempt>();
  const accepted = new Map<string, string>();
  const settled = new Set<string>();
  const answered = new Set<string>();
  let index = 0;
  for (const entry of entries) {
    index += 1;
    // An ambiguous create re-issues the same key inside one `placeCall`, so the
    // key is the call: a second record under it is the same attempt, not another.
    if (entry.kind === "call_attempt" && !attempts.has(entry.idempotency_key)) {
      attempts.set(entry.idempotency_key, {
        entry: index,
        phase: entry.phase,
        party_id: entry.party_id,
        phone_masked: entry.phone_masked,
        slot_id: entry.slot_id,
        idempotency_key: entry.idempotency_key,
        call_id: null,
      });
    }
    if (entry.kind === "call_accepted") {
      accepted.set(entry.idempotency_key, entry.call_id);
    }
    if (entry.kind === "gather" || entry.kind === "commit" || entry.kind === "release" || entry.kind === "reconcile") {
      if (entry.result.idempotency_key !== null) {
        settled.add(entry.result.idempotency_key);
      }
      answered.add(`${entry.kind === "gather" ? "gather" : entry.result.phase}:${entry.result.party_id}`);
    }
  }
  return [...attempts.values()]
    .filter(
      (attempt) =>
        !settled.has(attempt.idempotency_key) && !answered.has(`${attempt.phase}:${attempt.party_id}`),
    )
    .map((attempt) => ({ ...attempt, call_id: accepted.get(attempt.idempotency_key) ?? null }));
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
 *
 * A call attempt with no result behind it is a problem too. It is the one a plain
 * reading of the phase entries cannot see: the call was accepted and the process
 * died before anything recorded what it did.
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
      const expected =
        entry.result.call_status === UNRESOLVED_STATUS
          ? feasible
          : entry.result.reached_person
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

  // A call CALL-E was asked to place and no entry ever settled. The call may have
  // gone ahead, so a history holding one of these cannot say what happened on the
  // phone, whatever its outcome line claims.
  for (const open of openAttempts(entries)) {
    issues.push({
      entry: open.entry,
      problem: `${open.party_id}'s ${open.phase} call was attempted${
        open.call_id === null ? "" : ` and accepted as ${open.call_id}`
      } and nothing in this ledger settles it`,
    });
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
