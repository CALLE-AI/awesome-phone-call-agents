/**
 * Recovery.
 *
 * A run can die between the confirm call that got a yes and the release call that
 * owes the apology and a create response can be lost while the call itself goes
 * ahead. Both leave a person believing an appointment is on with nobody left to
 * tell them otherwise. Replay can prove that happened. It cannot fix it.
 *
 * `resume` reads a ledger, settles every call whose fate is unknown and finishes
 * what the run owed. It never gathers availability again and never chooses a
 * different slot: a call it settles is the same call under the same idempotency
 * key and once the answers are known it either records the verbal confirmation
 * they support or releases everybody who said yes.
 */

import { CalleCallError, CalleWaitTimeout, type CallePort } from "./calle.js";
import { worstCaseCalls } from "./config.js";
import {
  assertDurableState,
  type CallOutcome,
  evaluateCommit,
  placeCall,
  releaseRound,
  TERMINAL_STATUSES,
  UNRESOLVED_STATUS,
} from "./coordinate.js";
import { withinCallingHours } from "./hours.js";
import {
  acquireLedgerLock,
  appendEntry,
  type OpenAttempt,
  openAttempts,
  readEntries,
  repairTornTail,
  requestDigest,
} from "./ledger.js";
import { confirmSchema, confirmTask, releaseSchema, releaseTask } from "./script.js";
import { slotById } from "./slots.js";
import { saidYes, type WindowSpan } from "./window.js";
import type {
  CallSnapshot,
  CommitResult,
  CoordinationRequest,
  LedgerEntry,
  Outcome,
  Party,
  RunResult,
  Slot,
} from "./types.js";

export class ResumeError extends Error {}

export interface ResumeOptions {
  request: CoordinationRequest;
  port: CallePort;
  ledgerPath: string;
  pollIntervalMs?: number;
  now?: () => number;
  onProgress?: (line: string) => void;
}

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

/**
 * A call is unsettled when the ledger cannot say what it did. No call id means
 * the create response was lost and the call may still have gone out. A call id
 * with a status that is not terminal means it was still running when this process
 * stopped. A call the coordinator declined to place is settled: it never happened.
 */
export function unsettledCall(result: CommitResult): boolean {
  if (result.call_status === "not_placed") {
    return false;
  }
  if (result.call_id === null) {
    return true;
  }
  return !TERMINAL_STATUSES.has(result.call_status);
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
 * Wait out a call that already exists. This places nothing.
 *
 * The same two kinds as a fresh call. A read that fails, and a call CALL-E has
 * not finished with, leave it unresolved with its id kept, so it stays this
 * app's to settle rather than becoming an answer. The key comes from the ledger
 * and is carried through untouched, so the entry this produces still names the
 * key the call was created under.
 */
async function settleExisting(
  port: CallePort,
  callId: string,
  key: string | null,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<CallOutcome> {
  const settle = (call: CallSnapshot, errorCode: string | null): CallOutcome => ({
    call,
    callId,
    idempotencyKey: key,
    errorCode: errorCode ?? (TERMINAL_STATUSES.has(call.status) ? null : "not_finished"),
    unresolved: !TERMINAL_STATUSES.has(call.status),
  });
  const read = async (errorCode: string): Promise<CallOutcome> => {
    try {
      return settle(await port.getCall(callId), errorCode);
    } catch (error) {
      const code = error instanceof CalleCallError ? error.code : "sdk_error";
      return { call: null, callId, idempotencyKey: key, errorCode: `${errorCode}, then ${code}`, unresolved: true };
    }
  };
  try {
    return settle(await port.waitForResult(callId, { timeoutMs, intervalMs: pollIntervalMs }), null);
  } catch (error) {
    if (error instanceof CalleWaitTimeout) {
      return read("timed_out");
    }
    return read(error instanceof CalleCallError ? error.code : "sdk_error");
  }
}

function partyById(request: CoordinationRequest, id: string): Party | undefined {
  return request.parties.find((party) => party.id === id);
}

export async function resumeCoordination(options: ResumeOptions): Promise<RunResult> {
  assertDurableState(options.port, options.ledgerPath);
  const lock = acquireLedgerLock(options.ledgerPath);
  try {
    return await recover(options);
  } finally {
    lock.release();
  }
}

function describe(result: CommitResult): string {
  if (result.call_status === UNRESOLVED_STATUS) {
    return `still cannot be accounted for (${result.failure_code ?? "no answer from CALL-E"})`;
  }
  if (result.phase === "release") {
    return result.acknowledged ? "reached a person" : "reached no person";
  }
  if (result.confirmed) {
    return "was confirmed after all";
  }
  if (result.declined) {
    return "was declined";
  }
  return `gave no confirmation (${result.failure_code ?? result.call_status})`;
}

function finish(
  request: CoordinationRequest,
  outcome: Outcome,
  chosen: Slot | undefined,
  unreleased: string[],
  callsPlaced: number,
  note: string,
  ledgerPath: string,
): RunResult {
  const confirmedWith = outcome === "verbally_confirmed" ? request.parties.map((party) => party.id) : [];
  return {
    request_id: request.requestId,
    outcome,
    slot_id: outcome === "verbally_confirmed" ? (chosen?.id ?? null) : null,
    slot_spoken: outcome === "verbally_confirmed" ? (chosen?.spoken ?? null) : null,
    confirmed_with: confirmedWith,
    unreleased,
    calls_placed: callsPlaced,
    calls_saved: Math.max(worstCaseCalls(request) - callsPlaced, 0),
    note,
    ledger_path: ledgerPath,
  };
}

async function recover(options: ResumeOptions): Promise<RunResult> {
  const { request, port } = options;
  const now = options.now ?? (() => Date.now());
  const progress = options.onProgress ?? (() => {});
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  // A crash between the write and the newline leaves half an entry at the end of
  // the file. Dropping it here, under the lock, is what lets the rest of the
  // history be read and appended to. What it described is gone, so say so.
  const torn = repairTornTail(options.ledgerPath);
  if (torn) {
    progress("The last ledger line was half written, which is what a crash during an append leaves. It was dropped.");
  }
  const entries = readEntries(options.ledgerPath);
  const started = entries.find((entry) => entry.kind === "run_started");
  if (started === undefined || started.kind !== "run_started") {
    throw new ResumeError(`${options.ledgerPath} has no run_started entry, so there is no run to resume.`);
  }
  if (started.request_digest !== requestDigest(request)) {
    throw new ResumeError(
      `${options.ledgerPath} was written from a different request. Resume finishes the coordination this ledger recorded, so it needs the request that started it: who is called, on which slot, inside which calling hours and against which window.`,
    );
  }
  const state = inspectLedger(entries);
  const chosen = state.chosenSlotId === null ? undefined : slotById(request.slots, state.chosenSlotId);
  /**
   * The window belongs to the coordination, not to this process. It opened when
   * the run started and `resume` is that same coordination finishing, so a yes
   * this ledger already holds is judged against the window it was given in and
   * nobody new is asked to commit once that window has closed.
   */
  const windowStart = Date.parse(started.at);
  const deadline = windowStart + started.policy.windowMinutes * 60_000;
  const span = (): WindowSpan => ({ windowStart, deadline, now: now() });
  const record = (entry: LedgerEntry): void => {
    appendEntry(options.ledgerPath, entry);
  };
  const stamp = (): string => new Date(now()).toISOString();

  if (state.finished && state.unsettled.length === 0 && state.owedReleases.length === 0) {
    progress("Nothing to resume: every call is settled and nobody is owed a release call.");
    return finish(
      request,
      state.outcome ?? "not_confirmed",
      chosen,
      [],
      state.callsPlaced,
      torn ? "nothing to resume, the half written last line was dropped" : "nothing to resume",
      options.ledgerPath,
    );
  }

  record({
    kind: "resume_started",
    at: stamp(),
    entries_before: entries.length,
    // Every call the ledger cannot account for, including the gather calls this
    // run will not place again. A record of what was open is worth more than a
    // record of only what this run intended to touch.
    ambiguous: [
      ...state.unsettled.map((result) => `${result.phase}:${result.party_id}`),
      ...state.unsettledGathers.map((party) => `gather:${party}`),
    ],
    owed_releases: state.owedReleases,
  });
  progress(
    `Resuming ${request.requestId}: ${state.unsettled.length} unsettled, ${state.owedReleases.length} owed a release call.`,
  );

  let calls = state.callsPlaced;
  const confirmed = [...state.confirmed];
  const released = new Set(state.released);
  /** Everybody the ledger says is owed a release call, plus anybody this round finds. */
  const owedNow = new Set(state.owedReleases);
  const stuck: string[] = [];
  /** Confirm calls this round still cannot account for. Nothing is decided while one stands. */
  const openConfirms: string[] = [];
  /** Release calls this round already re-issued, so the round below does not repeat them. */
  const handledReleases = new Set<string>();
  const timeoutMs = Math.max(request.policy.perCallTimeoutSeconds * 1000, 1_000);

  // A gather call the ledger cannot account for is named and left alone. `resume`
  // never gathers availability again, so there is no call it could place that would
  // settle one. A call it cannot settle must not be allowed to look settled.
  for (const party of state.unsettledGathers) {
    progress(
      `  ${party}: a gather call was accepted and no answer was ever recorded. Resume settles confirm and release calls only, so check that call by hand.`,
    );
    stuck.push(party);
  }

  for (const previous of state.unsettled) {
    const party = partyById(request, previous.party_id);
    const slot = chosen ?? slotById(request.slots, previous.slot_id);
    const recordedKey = previous.idempotency_key;
    if (party === undefined || slot === undefined) {
      stuck.push(previous.party_id);
      continue;
    }
    let outcome: CallOutcome;
    let placedCall = false;
    if (previous.call_id !== null) {
      outcome = await settleExisting(port, previous.call_id, recordedKey, timeoutMs, pollIntervalMs);
    } else if (recordedKey === null) {
      // No call id and no key. The key could be derived again and a derived key is
      // built from the task text, which lives in this repo rather than in the
      // ledger, so it may not be the string the lost create used. A key CALL-E has
      // never seen places a second call to somebody whose first one may still be
      // live, which is the one thing recovery must never do. So this call is not
      // settled at all: it is named for a person, who can find it at CALL-E by the
      // request id and the party in the call metadata. Entries written before keys
      // were recorded are the only ones that look like this.
      progress(
        `  ${party.id}: the ${previous.phase} call cannot be settled, the ledger recorded no idempotency key for it and a derived key could ring them a second time. Check that call by hand.`,
      );
      stuck.push(party.id);
      continue;
    } else if (previous.phase === "confirm" && now() >= deadline) {
      // The key would place this call if CALL-E does not already have it, and
      // asking somebody to commit to a time this coordination can no longer act
      // on is a call nobody should get. Anybody who said yes is released instead.
      progress(`  ${party.id}: the confirm call cannot be settled, the coordination window has closed.`);
      stuck.push(party.id);
      continue;
    } else if (previous.phase === "confirm" && slot.startMs <= now()) {
      // The key would answer the question, but if the create never landed the key
      // places the call and confirming a time that has already started is a call
      // nobody should get. Report it instead.
      progress(`  ${party.id}: the confirm call cannot be settled, ${slot.id} has already started.`);
      stuck.push(party.id);
      continue;
    } else if (calls >= request.policy.maxCalls) {
      progress(`  ${party.id}: the ${previous.phase} call cannot be settled, the call budget is spent.`);
      stuck.push(party.id);
      continue;
    } else if (!withinCallingHours(party.callingHours, now())) {
      progress(`  ${party.id}: the ${previous.phase} call cannot be settled inside their calling hours.`);
      stuck.push(party.id);
      continue;
    } else {
      // The key the ledger recorded, not a fresh one. CALL-E answers with the
      // call it already has under that key or places the one this run owed.
      // Charged to the budget either way, because from here the two cannot be
      // told apart. Deriving the key again would be a different key the moment
      // any call script in this repo changed between the crash and the resume,
      // and a different key rings a second phone. An entry with no recorded key
      // never reaches this line: it was refused above.
      placedCall = true;
      calls += 1;
      outcome = await placeCall({
        request,
        port,
        party,
        phase: previous.phase,
        slot,
        task: previous.phase === "release" ? releaseTask(request, party, slot) : confirmTask(request, party, slot),
        schema: previous.phase === "release" ? releaseSchema() : confirmSchema(),
        timeoutMs,
        pollIntervalMs,
        record,
        now,
        key: recordedKey,
      });
    }
    const result = evaluateCommit(request, party, slot, previous.phase, outcome, span());
    record({ kind: "reconcile", at: stamp(), placed_call: placedCall, result });
    if (unsettledCall(result)) {
      stuck.push(party.id);
      if (result.phase === "confirm") {
        openConfirms.push(party.id);
      }
    }
    if (result.phase === "release") {
      handledReleases.add(party.id);
    }
    if (result.phase === "confirm" && result.confirmed && !confirmed.includes(party.id)) {
      confirmed.push(party.id);
    }
    if (saidYes(result)) {
      // Settling the call is how this run learns they said yes. Late or not, they
      // are owed the call that says it is off.
      owedNow.add(party.id);
    }
    if (result.phase === "release" && result.acknowledged) {
      released.add(party.id);
    }
    progress(`  ${party.id}: the ${previous.phase} call ${describe(result)}.`);
  }

  const everybody = request.parties.map((party) => party.id);
  const allConfirmed = everybody.every((party) => confirmed.includes(party));
  let outcome: Outcome;
  if (chosen !== undefined && allConfirmed && stuck.length === 0 && state.releasesRecorded === 0) {
    // Nobody has been told it is off yet, so a full set of yeses still stands.
    outcome = "verbally_confirmed";
  } else if (openConfirms.length > 0) {
    // A confirm call that may still be live could yet agree the time, so nothing
    // is decided and nobody is told it is off. The debt is recorded and the next
    // `resume` settles it.
    outcome = "unresolved";
  } else if (
    state.outcome !== null &&
    state.outcome !== "verbally_confirmed" &&
    state.outcome !== "unresolved"
  ) {
    outcome = state.outcome;
  } else {
    outcome = "not_confirmed";
  }

  const unreleased: string[] = [];
  // Everybody who said yes, plus every debt the ledger already recorded, minus
  // the people a release call actually reached. A debt is not written off because
  // a call ended.
  const debt = [...new Set([...confirmed, ...owedNow])].filter((party) => !released.has(party));
  if (outcome === "unresolved") {
    unreleased.push(...debt);
  } else if (outcome !== "verbally_confirmed" && chosen !== undefined) {
    const owed = debt
      // A release call this round already re-issued is not called a second time in
      // the same pass. It is still owed and it is reported as owed.
      .filter((party) => !handledReleases.has(party))
      .map((party) => partyById(request, party))
      .filter((party): party is Party => party !== undefined)
      .reverse();
    if (owed.length > 0) {
      progress(`Releasing ${owed.length === 1 ? "the party" : "the parties"} who said yes.`);
    }
    const round = await releaseRound({
      request,
      port,
      slot: chosen,
      parties: owed,
      callsPlaced: calls,
      pollIntervalMs,
      now,
      progress,
      record,
    });
    calls = round.callsPlaced;
    unreleased.push(...round.unreleased, ...debt.filter((party) => handledReleases.has(party)));
  }

  const notes: string[] = [
    outcome === "verbally_confirmed"
      ? `resumed and settled, every party confirmed ${chosen?.id ?? "the time"} by voice`
      : "resumed an unfinished run, nothing is going ahead",
  ];
  if (stuck.length > 0) {
    notes.push(`still unsettled, check by hand: ${[...new Set(stuck)].join(", ")}`);
  }
  if (state.unsettledGathers.length > 0) {
    notes.push(
      `${state.unsettledGathers.length === 1 ? "a gather call" : "gather calls"} nobody can account for, which resume does not settle: ${state.unsettledGathers.join(", ")}`,
    );
  }
  if (torn) {
    notes.push("the last line was half written and was dropped, so a call it may have recorded is not settled here");
  }
  if (unreleased.length > 0) {
    notes.push(`still owed a release call: ${unreleased.join(", ")}`);
  }
  const note = notes.join("; ");

  record({
    kind: "outcome",
    at: stamp(),
    outcome,
    slot_id: outcome === "verbally_confirmed" ? (chosen?.id ?? null) : null,
    confirmed_with: outcome === "verbally_confirmed" ? everybody : [],
    unreleased,
    calls_placed: calls,
    note,
  });
  return finish(request, outcome, chosen, unreleased, calls, note, options.ledgerPath);
}
