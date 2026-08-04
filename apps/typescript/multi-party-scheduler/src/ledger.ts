/**
 * The coordination ledger.
 *
 * Every call, every narrowing of the feasible set, the commit decision and every
 * release call is appended as one JSON line. The point is not that a log exists.
 * The point is `replay`, which walks the recorded answers and recomputes the
 * feasible set, the chosen slot and the outcome. If the ledger says Thursday but
 * the recorded answers do not intersect on Thursday, replay says so.
 *
 * It also answers what a history leaves open: which attempts nothing accounts for,
 * whether a call may go out under a key the provider has never seen and what a
 * round still owes. Those answers live here rather than beside one caller because a
 * fresh run, a recovery and replay all have to give the same one.
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
import { UNRESOLVED_STATUS, unsettledCall } from "./call-state.js";
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
  /** Which attempt at that call this was. 1 on a ledger written before they were numbered. */
  attempt: number;
  idempotency_key: string;
  /** The accepted call id when the create got that far. Null when it did not. */
  call_id: string | null;
}

/** Every entry that records what one call did. */
function isPhaseEntry(
  entry: LedgerEntry,
): entry is LedgerEntry & { kind: "gather" | "commit" | "release" | "reconcile" } {
  return entry.kind === "gather" || entry.kind === "commit" || entry.kind === "release" || entry.kind === "reconcile";
}

function phaseOf(entry: LedgerEntry & { kind: "gather" | "commit" | "release" | "reconcile" }): Phase {
  return entry.kind === "gather" ? "gather" : entry.result.phase;
}

/**
 * Every attempt with no result behind it.
 *
 * `placeCall` writes a `call_attempt` before the create and a `call_accepted` the
 * moment CALL-E returns an id, so a process death between provider acceptance and
 * the phase entry leaves the key on disk, usually with the call id. This finds the
 * attempts that were left that way: no entry names the key they went out under.
 *
 * The match is by key and not by party and phase, because one call can now have
 * more than one attempt. A release call that reached a machine is retried under a
 * key of its own, so the entry settling the first attempt says nothing about the
 * second and reading it as an answer for both would hide exactly the call nobody
 * can account for. A result carrying no key at all is the one thing still matched
 * by party and phase: those are ledgers written before keys were recorded and
 * there is nothing else about them to match on.
 *
 * Replay and recovery both read this, so the two cannot drift apart on which calls
 * are unaccounted for.
 */
export function openAttempts(entries: LedgerEntry[]): OpenAttempt[] {
  const attempts = new Map<string, OpenAttempt>();
  const accepted = new Map<string, string>();
  const settled = new Set<string>();
  const answeredWithoutKey = new Set<string>();
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
        attempt: entry.attempt ?? 1,
        idempotency_key: entry.idempotency_key,
        call_id: null,
      });
    }
    if (entry.kind === "call_accepted") {
      accepted.set(entry.idempotency_key, entry.call_id);
    }
    if (isPhaseEntry(entry)) {
      if (entry.result.idempotency_key !== null) {
        settled.add(entry.result.idempotency_key);
      } else {
        answeredWithoutKey.add(`${phaseOf(entry)}:${entry.result.party_id}`);
      }
    }
  }
  return [...attempts.values()]
    .filter(
      (attempt) =>
        !settled.has(attempt.idempotency_key) &&
        !answeredWithoutKey.has(`${attempt.phase}:${attempt.party_id}`),
    )
    .map((attempt) => ({ ...attempt, call_id: accepted.get(attempt.idempotency_key) ?? null }));
}

/**
 * The highest attempt at this exact call the ledger already holds, 0 when it holds
 * none.
 *
 * The number goes into the idempotency key, so it is what makes a retry a call the
 * provider has never seen rather than a replay of the one it already holds. It is
 * read off the ledger rather than counted in memory, because the run that placed
 * the earlier attempts is usually a process that is no longer running.
 */
function highestAttempt(
  entries: LedgerEntry[],
  phase: Phase,
  partyId: string,
  slotId: string | null,
): number {
  let highest = 0;
  for (const entry of entries) {
    if (
      entry.kind === "call_attempt" &&
      entry.phase === phase &&
      entry.party_id === partyId &&
      entry.slot_id === slotId
    ) {
      highest = Math.max(highest, entry.attempt ?? 1);
    }
  }
  return highest;
}

/**
 * The attempt at this call that the ledger cannot account for, if there is one.
 *
 * Two shapes count. An attempt record with nothing naming its key, which is the
 * crash window. And a recorded result this app cannot read as finished, which is a
 * call that was still running or that nobody could read. Either one may be on the
 * phone to somebody right now, so a new attempt must not be minted while one
 * stands: the key it went out under has to be re-issued instead. Returns that key,
 * or null when every attempt at the call is accounted for.
 *
 * The last word wins, so an entry that later settles an unresolved call clears it.
 */
export function unaccountedAttempt(entries: LedgerEntry[], phase: Phase, partyId: string): string | null {
  let open: string | null = null;
  for (const entry of entries) {
    if (isPhaseEntry(entry) && phaseOf(entry) === phase && entry.result.party_id === partyId) {
      open = unsettledCall(entry.result) ? entry.result.idempotency_key : null;
    }
  }
  if (open !== null) {
    return open;
  }
  const orphan = openAttempts(entries).find(
    (attempt) => attempt.phase === phase && attempt.party_id === partyId,
  );
  return orphan?.idempotency_key ?? null;
}

/**
 * Whether a call may go out under a new key.
 *
 * Either the attempt number to mint or the reason nothing may be minted, in a sentence
 * a caller can print. Never both and never neither, so a caller that finds no number
 * has the refusal in hand.
 */
export type AttemptVerdict = { attempt: number; refusal: null } | { attempt: null; refusal: string };

/**
 * Whether this call may be placed under a key the provider has never seen.
 *
 * The attempt number is part of the key, so minting one is not bookkeeping: it is a
 * decision to ring somebody. One rule, and both places that derive a key ask it, the
 * coordinator for a gather or a confirm call and the release round for a release
 * call, so a fresh coordination and a recovery cannot answer it differently.
 * Recovery derives no key at all, it re-issues the one the ledger recorded.
 *
 * A new key is minted for a call this ledger holds no attempt for. The single
 * exception is a release retry that was asked for and whose last attempt is settled.
 *
 * Nothing else may mint one and that is the rule rather than a special case. A
 * gather or a confirm call is placed once per coordination, so a second attempt at
 * one is a second phone call about an answer already on disk: an outcome the ledger
 * has settled is read, never coordinated again. A release call is the one call this
 * app places twice, because a release nobody acknowledged leaves the person owed,
 * and even then the last attempt has to be accounted for first. While one may be on
 * the phone to somebody, the key it went out under is re-issued instead.
 */
export function attemptToMint(
  entries: LedgerEntry[],
  phase: Phase,
  partyId: string,
  slotId: string | null,
  authorizedRetry = false,
): AttemptVerdict {
  const highest = highestAttempt(entries, phase, partyId, slotId);
  if (highest === 0) {
    return { attempt: 1, refusal: null };
  }
  if (phase !== "release") {
    return {
      attempt: null,
      refusal: `this ledger already records a ${phase} call to that party (attempt ${highest}) and a coordination places one, so a new key would ring them again about an answer already on disk`,
    };
  }
  const pending = unaccountedAttempt(entries, phase, partyId);
  if (pending !== null) {
    return {
      attempt: null,
      refusal: `an earlier attempt is unaccounted for (${pending}) and has to be settled under its own key before another one is placed`,
    };
  }
  if (!authorizedRetry) {
    return {
      attempt: null,
      refusal: `attempt ${highest} is settled and nobody asked for another one, which resume --retry-release does`,
    };
  }
  return { attempt: highest + 1, refusal: null };
}

/**
 * The payload and the provider each recorded key went out against.
 *
 * Recovery re-issues a recorded key rather than deriving one, so nothing about that
 * key is recomputed and nothing about it is checked either unless this is read. The
 * digest says the words behind the key have not changed. The origin and the account
 * say the namespace the key lives in has not changed. Keyed by the string that went
 * on the wire, first record per key, because an ambiguous create re-issues the same
 * key with the same payload.
 */
export interface AttemptRecord {
  attempt: number;
  payload_digest: string;
  provider_origin: string | null;
  provider_account: string | null;
}

export function attemptRecords(entries: LedgerEntry[]): Map<string, AttemptRecord> {
  const records = new Map<string, AttemptRecord>();
  for (const entry of entries) {
    if (entry.kind !== "call_attempt" || records.has(entry.idempotency_key)) {
      continue;
    }
    records.set(entry.idempotency_key, {
      attempt: entry.attempt ?? 1,
      payload_digest: entry.payload_digest,
      provider_origin: entry.provider_origin ?? null,
      provider_account: entry.provider_account ?? null,
    });
  }
  return records;
}

/**
 * What a ledger says about the round it holds and about what is left to do.
 *
 * Recovery reads this to decide what to settle. A fresh `run` reads it too, before
 * it places anything: a coordination this file already records is returned or handed
 * to `resume`, never coordinated a second time, because every key a second run
 * derived would carry the next attempt number and ring everybody again. One reader,
 * so the two cannot disagree about what is finished and what is owed.
 */
export interface RecoveryState {
  entries: number;
  finished: boolean;
  outcome: Outcome | null;
  chosenSlotId: string | null;
  callsPlaced: number;
  /** Parties with a recorded confirmation, in the order they first gave it. */
  confirmed: string[];
  /**
   * Parties a person acknowledged a release call for. Nothing else clears the
   * debt: a release call can end and still have told nobody.
   */
  released: string[];
  /** How many release calls this ledger holds. One is enough to make it off. */
  releasesRecorded: number;
  /** Calls whose fate the ledger does not settle. */
  unsettled: CommitResult[];
  /**
   * Gather calls the ledger cannot account for, by party.
   *
   * These are not recovery's to finish. `resume` never gathers availability
   * again, so there is no call it could place that would settle one. Nothing is
   * owed to anybody from a gather call either. They are reported for a person to
   * check instead, which is the same answer the coordinator gives when a gather
   * call goes unresolved mid run.
   */
  unsettledGathers: string[];
  owedReleases: string[];
}

/**
 * What the ledger knows about a call it never recorded a result for.
 *
 * Every field here is read off the attempt record or stated as unknown. The status
 * is this app's own `unresolved`, so recovery owns it and nothing is decided off
 * it. The failure code says no result was ever written rather than naming a
 * failure nobody observed. Nothing is inferred about what the call did: not
 * knowing is why it is in this list.
 */
function openResult(open: OpenAttempt): CommitResult {
  return {
    party_id: open.party_id,
    phone_masked: open.phone_masked,
    phase: open.phase,
    slot_id: open.slot_id ?? "",
    call_id: open.call_id,
    provider_call_id: null,
    idempotency_key: open.idempotency_key,
    call_status: UNRESOLVED_STATUS,
    confirmed: false,
    declined: false,
    acknowledged: false,
    within_window: false,
    window_reason: null,
    completion_time_usable: false,
    question_asked: false,
    reached_person: false,
    machine_answered: false,
    structured_answer: null,
    heard_answer: null,
    disagreement: false,
    confidence: null,
    transcript_excerpt: [],
    failure_code: "no_result_recorded",
  };
}

export function inspectLedger(entries: LedgerEntry[]): RecoveryState {
  let callsPlaced = 0;
  let chosenSlotId: string | null = null;
  let outcome: Outcome | null = null;
  const confirmOrder: string[] = [];
  const credited = new Map<string, boolean>();
  const spokenYes: string[] = [];
  const released = new Set<string>();
  const owed = new Set<string>();
  const unsettled = new Map<string, CommitResult>();
  let releasesRecorded = 0;

  for (const entry of entries) {
    if (entry.kind === "gather") {
      callsPlaced += 1;
    }
    if (entry.kind === "slot_chosen") {
      chosenSlotId = entry.slot_id;
    }
    if (entry.kind === "commit" || entry.kind === "release" || entry.kind === "reconcile") {
      const result = entry.result;
      if (entry.kind !== "reconcile" || entry.placed_call) {
        callsPlaced += 1;
      }
      const key = `${result.phase}:${result.party_id}`;
      if (unsettledCall(result)) {
        unsettled.set(key, result);
      } else {
        unsettled.delete(key);
      }
      if (result.phase === "confirm") {
        if (!confirmOrder.includes(result.party_id)) {
          confirmOrder.push(result.party_id);
        }
        // Credit is the ledger's last word on that call, so a later entry
        // settling the same call replaces it rather than adding to it. A yes
        // recorded outside the window is not credit at all.
        credited.set(result.party_id, result.confirmed && result.within_window !== false);
        // A debt only grows. Somebody who said yes has to be told. No later
        // entry talks this app out of placing that call.
        if (saidYes(result) && !spokenYes.includes(result.party_id)) {
          spokenYes.push(result.party_id);
        }
      }
      if (result.phase === "release") {
        releasesRecorded += 1;
        // Only acknowledged delivery settles the debt. A release call that
        // failed, was canceled or left a message on a machine is over and the
        // person still has not been told, so they are owed the call.
        if (result.acknowledged) {
          released.add(result.party_id);
          owed.delete(result.party_id);
        } else {
          owed.add(result.party_id);
        }
      }
    }
    if (entry.kind === "outcome") {
      outcome = entry.outcome;
      // A debt this run wrote down stays a debt. Only an acknowledged delivery
      // after it can clear it, which is why this reads the released set rather
      // than trusting a later terminal entry.
      for (const party of entry.unreleased) {
        if (!released.has(party)) {
          owed.add(party);
        }
      }
    }
  }

  // Calls this ledger records as attempted with no result behind them. That is the
  // crash window: CALL-E accepted the call and the process died before the entry
  // that would have said what it did. There is nothing to read, so the record is
  // built from the attempt and says so.
  const gatherOrphans: string[] = [];
  for (const open of openAttempts(entries)) {
    if (open.phase === "gather") {
      if (!gatherOrphans.includes(open.party_id)) {
        gatherOrphans.push(open.party_id);
      }
      continue;
    }
    const key = `${open.phase}:${open.party_id}`;
    // The earliest attempt for that call is the one most likely to be live, so it
    // is the one recovery goes after.
    if (!unsettled.has(key)) {
      unsettled.set(key, openResult(open));
    }
  }

  const confirmed = confirmOrder.filter((party) => credited.get(party) === true);
  return {
    entries: entries.length,
    finished: outcome !== null,
    outcome,
    chosenSlotId,
    callsPlaced,
    confirmed,
    released: [...released],
    releasesRecorded,
    unsettled: [...unsettled.values()],
    unsettledGathers: gatherOrphans,
    // A release is owed only when the appointment is off. A run that ended in a
    // verbal confirmation owes nobody a call saying it is not happening, and
    // `resume` only reaches that outcome when no release call has gone out.
    owedReleases:
      outcome === "verbally_confirmed"
        ? []
        : [...new Set([...spokenYes, ...confirmed, ...owed])].filter(
            (party) => !released.has(party),
          ),
  };
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
      problem: `${open.party_id}'s ${open.phase} call${
        open.attempt > 1 ? `, attempt ${open.attempt},` : ""
      } was attempted${
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
