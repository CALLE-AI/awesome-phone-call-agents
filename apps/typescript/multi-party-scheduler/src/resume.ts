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
  type CallOutcome,
  evaluateCommit,
  placeCall,
  releaseRound,
  TERMINAL_STATUSES,
} from "./coordinate.js";
import { withinCallingHours } from "./hours.js";
import { acquireLedgerLock, appendEntry, readEntries, requestDigest } from "./ledger.js";
import { confirmSchema, confirmTask, releaseSchema, releaseTask } from "./script.js";
import { slotById } from "./slots.js";
import type {
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
  /** Parties with a recorded yes, in the order they gave it. */
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
  owedReleases: string[];
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
  const confirmed: string[] = [];
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
      if (result.phase === "confirm" && result.confirmed && !confirmed.includes(result.party_id)) {
        confirmed.push(result.party_id);
      }
      if (result.phase === "release") {
        releasesRecorded += 1;
        // Only acknowledged delivery settles the debt. A release call that
        // failed, was canceled, rang out, hit a busy line or left a message on a
        // machine is over and the person still has not been told, so they are
        // owed the call.
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
    // A release is owed only when the appointment is off. A run that ended in a
    // verbal confirmation owes nobody a call saying it is not happening, and
    // `resume` only reaches that outcome when no release call has gone out.
    owedReleases:
      outcome === "verbally_confirmed"
        ? []
        : [...new Set([...confirmed.filter((party) => !released.has(party)), ...owed])],
  };
}

/** Wait out a call that already exists. This places nothing. */
async function settleExisting(
  port: CallePort,
  callId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<CallOutcome> {
  try {
    return { call: await port.waitForResult(callId, { timeoutMs, intervalMs: pollIntervalMs }), errorCode: null };
  } catch (error) {
    if (error instanceof CalleWaitTimeout) {
      return { call: await port.getCall(callId), errorCode: "timed_out" };
    }
    const code = error instanceof CalleCallError ? error.code : "sdk_error";
    return { call: null, errorCode: code };
  }
}

function partyById(request: CoordinationRequest, id: string): Party | undefined {
  return request.parties.find((party) => party.id === id);
}

export async function resumeCoordination(options: ResumeOptions): Promise<RunResult> {
  const lock = acquireLedgerLock(options.ledgerPath);
  try {
    return await recover(options);
  } finally {
    lock.release();
  }
}

function describe(result: CommitResult): string {
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
  const entries = readEntries(options.ledgerPath);
  const started = entries.find((entry) => entry.kind === "run_started");
  if (started === undefined || started.kind !== "run_started") {
    throw new ResumeError(`${options.ledgerPath} has no run_started entry, so there is no run to resume.`);
  }
  if (started.request_digest !== requestDigest(request)) {
    throw new ResumeError(
      `${options.ledgerPath} was written from a different request. Resume needs the request the run started with, because that is what rebuilds the same idempotency keys.`,
    );
  }
  const state = inspectLedger(entries);
  const chosen = state.chosenSlotId === null ? undefined : slotById(request.slots, state.chosenSlotId);
  const record = (entry: LedgerEntry): void => {
    appendEntry(options.ledgerPath, entry);
  };
  const stamp = (): string => new Date(now()).toISOString();

  if (state.finished && state.unsettled.length === 0 && state.owedReleases.length === 0) {
    progress("Nothing to resume: every call is settled and nobody is owed a release call.");
    return finish(request, state.outcome ?? "not_confirmed", chosen, [], state.callsPlaced, "nothing to resume", options.ledgerPath);
  }

  record({
    kind: "resume_started",
    at: stamp(),
    entries_before: entries.length,
    ambiguous: state.unsettled.map((result) => `${result.phase}:${result.party_id}`),
    owed_releases: state.owedReleases,
  });
  progress(
    `Resuming ${request.requestId}: ${state.unsettled.length} unsettled, ${state.owedReleases.length} owed a release call.`,
  );

  let calls = state.callsPlaced;
  const confirmed = [...state.confirmed];
  const released = new Set(state.released);
  const stuck: string[] = [];
  const timeoutMs = Math.max(request.policy.perCallTimeoutSeconds * 1000, 1_000);

  for (const previous of state.unsettled) {
    const party = partyById(request, previous.party_id);
    const slot = chosen ?? slotById(request.slots, previous.slot_id);
    if (party === undefined || slot === undefined) {
      stuck.push(previous.party_id);
      continue;
    }
    let outcome: CallOutcome;
    let placedCall = false;
    if (previous.call_id !== null) {
      outcome = await settleExisting(port, previous.call_id, timeoutMs, pollIntervalMs);
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
      // The same idempotency key. CALL-E answers with the call it already has, or
      // places the one this run owed. Charged to the budget either way, because
      // from here the two cannot be told apart.
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
      });
    }
    const result = evaluateCommit(request, party, slot, previous.phase, outcome);
    record({ kind: "reconcile", at: stamp(), placed_call: placedCall, result });
    if (unsettledCall(result)) {
      stuck.push(party.id);
    }
    if (result.phase === "confirm" && result.confirmed && !confirmed.includes(party.id)) {
      confirmed.push(party.id);
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
  } else if (state.outcome !== null && state.outcome !== "verbally_confirmed") {
    outcome = state.outcome;
  } else {
    outcome = "not_confirmed";
  }

  const unreleased: string[] = [];
  if (outcome !== "verbally_confirmed" && chosen !== undefined) {
    // Everybody who said yes, plus every debt the ledger already recorded, minus
    // the people a release call actually reached. A debt is not written off
    // because a call ended.
    const debt = [...new Set([...confirmed, ...state.owedReleases])];
    const owed = debt
      .filter((party) => !released.has(party))
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
    unreleased.push(...round.unreleased);
  }

  const notes: string[] = [
    outcome === "verbally_confirmed"
      ? `resumed and settled, every party confirmed ${chosen?.id ?? "the time"} by voice`
      : "resumed an unfinished run, nothing is going ahead",
  ];
  if (stuck.length > 0) {
    notes.push(`still unsettled, check by hand: ${[...new Set(stuck)].join(", ")}`);
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
