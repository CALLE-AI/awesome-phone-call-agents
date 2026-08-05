/**
 * The protocol: gather, then commit and release if the commit fails.
 *
 * Phase 1 calls each party once and narrows the feasible set after every answer,
 * so later calls read a shorter list and an impossible schedule is discovered
 * before the whole list has been dialled.
 *
 * Phase 2 confirms exactly one slot with every party. If any party does not
 * confirm, nothing is booked and every party that already confirmed gets a
 * release call. That call is the part a human coordinator forgets and it is why
 * this is a protocol rather than a list of phone calls.
 *
 * Two reading rules, both conservative in the same direction:
 * availability needs the extracted list and the transcript to agree and a
 * commitment needs the transcript to say it. The extracted answer can veto a
 * commitment, it can never create one.
 *
 * What happens when this process dies mid-commit lives in `resume.ts`, which
 * reuses `placeCall` and `releaseRound` from here so a recovered call is the same
 * call under the same idempotency key.
 *
 * A coordination lives in one ledger and runs once. A `run` pointed at a ledger that
 * already records this coordination hands back what the file holds or sends it to
 * `resume` rather than opening a second round: the attempt number in every key is
 * counted from that file, so a second round derives a key the provider has never seen
 * for every call in it and rings everybody again.
 */

import { CalleCallError, CalleWaitTimeout, type CallePort, type CreateCallInput } from "./calle.js";
import { ConfigError, worstCaseCalls } from "./config.js";
import { clockOf, withinCallingHours } from "./hours.js";
import {
  acquireLedgerLock,
  appendEntry,
  attemptToMint,
  digestOf,
  inspectLedger,
  LedgerError,
  readLedger,
  replay,
  requestDigest,
} from "./ledger.js";
import { readConfirm, readGather, readRelease } from "./read.js";
import { chooseSlot, intersect, slotById } from "./slots.js";
import { NOT_PLACED_STATUS, TERMINAL_STATUSES, UNRESOLVED_STATUS } from "./call-state.js";
import { completionInstant, judgeWindow, saidYes, type WindowSpan, type WindowVerdict } from "./window.js";
import {
  confirmSchema,
  confirmTask,
  gatherSchema,
  gatherTask,
  idempotencyKey,
  metadata,
  releaseSchema,
  releaseTask,
} from "./script.js";
import type {
  CallSnapshot,
  CommitResult,
  CoordinationRequest,
  GatherResult,
  JsonSchema,
  LedgerEntry,
  Outcome,
  Party,
  Phase,
  RunResult,
  Slot,
} from "./types.js";

export interface RunOptions {
  request: CoordinationRequest;
  port: CallePort;
  ledgerPath?: string | null;
  pollIntervalMs?: number;
  now?: () => number;
  onProgress?: (line: string) => void;
  /**
   * Cancels the run in flight. No new gather or confirm call is placed once it
   * fires. Release calls still go out: canceling the booking does not cancel the
   * duty to tell somebody who already said yes. A call already connected cannot
   * be hung up, the API has no cancel, so it is recorded as unfinished and
   * `resume` reconciles it.
   */
  signal?: AbortSignal;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 5) {
    return "***";
  }
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(phone.length - 5, 1))}${phone.slice(-2)}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export interface CallOutcome {
  call: CallSnapshot | null;
  errorCode: string | null;
  /**
   * True when a call may exist and this app cannot say what it did. The round
   * stops on one of these: the same key is re-issued to find the call and
   * nothing is decided off it.
   */
  unresolved: boolean;
  /** The call id whenever one is known, even when nothing could be read from it. */
  callId: string | null;
  /**
   * The key this call was created under, so it reaches the ledger. It is the only
   * handle on a create whose response was lost. Null when no call was attempted.
   */
  idempotencyKey: string | null;
}

/**
 * Statuses a call can no longer move out of, the status this app records for a call
 * it cannot account for and the status for a call that never went out. All three
 * live in `call-state.ts` so the coordinator, recovery and replay cannot drift apart
 * on what finished means.
 */
export { NOT_PLACED_STATUS, TERMINAL_STATUSES, UNRESOLVED_STATUS } from "./call-state.js";

/**
 * A port that dials real phones may not place its first call with no durable
 * state.
 *
 * With no ledger every recovery entry is discarded, so a crash or a second
 * interrupt after somebody has said yes on a call leaves no way to reconcile that
 * call and nobody to tell them the time is off. The CLI refuses this at the flag.
 * This is the same refusal one level down, so a caller that embeds the
 * coordinator cannot lose it. A port pointed at the local fake CALL-E is not
 * live, which is why the unit suite can still run in memory.
 */
export function assertDurableState(port: CallePort, ledgerPath: string | null): void {
  if (port.live !== true) {
    return;
  }
  if (ledgerPath === null || ledgerPath.length === 0) {
    throw new ConfigError(
      "This port places real calls, so it needs a ledger: pass --ledger <file> or ledgerPath. That file is what resume reads to settle a call this run could not finish and to place the release calls it owes. Nothing was dialled.",
    );
  }
}

class Aborted extends Error {}

/**
 * A ledger that already records a coordination is not one `run` may add to.
 *
 * Its own class, so a caller can tell "this belongs to resume" from a file that is
 * broken, and a `LedgerError`, so the CLI already reports it as the usage error it
 * is.
 */
export class AlreadyCoordinatedError extends LedgerError {}

/**
 * What `run` may do with a ledger that already holds this coordination.
 *
 * The ledger is the coordination's durable state and the attempt number in every key
 * is counted from it, so a second run is not a fresh start: each gather and confirm
 * call derives a key one attempt higher, CALL-E has never seen that key, and every
 * party is rung again about an answer already on disk. On an interrupted ledger it is
 * worse than a duplicate call, because the second round closes the file with a clean
 * outcome of its own and a release call the first round owed somebody is written out
 * of the history.
 *
 * Three answers and no fourth. A round that finished with nothing left open is handed
 * back as it stands and no call is placed, so running twice is reading twice. A round
 * that did not finish, or that finished owing a call, is `resume`'s: that is the one
 * path that settles a call under the key it went out under instead of minting a new
 * one. Anything else about the file, a coordination that is not this one or lines no
 * run opened, is refused outright.
 *
 * The handback is not a free pass either. A ledger is handed back only when a replay of
 * it supports the outcome it records. A file that is syntactically complete, has no
 * unsettled call and owes no release can still be inconsistent: an outcome of
 * verbally_confirmed with a party never credited, a recorded slot the answers do not
 * choose, a call count that does not match the entries. Returning one of those as a
 * success would be this app vouching for a coordination that never happened, with
 * nothing on a phone to show for it. So the replay runs before the handback and a ledger
 * that fails it is refused rather than trusted.
 *
 * Returns the result to hand back, or null when the ledger is fresh and this run may
 * go ahead. Refuses by throwing, before anything is dialled.
 */
function recordedRound(
  request: CoordinationRequest,
  ledgerPath: string,
  entries: LedgerEntry[],
  torn: boolean,
  progress: (line: string) => void,
): RunResult | null {
  const recover = `Run resume --request <file> --ledger ${ledgerPath} --live. Nothing was dialled.`;
  if (torn) {
    // Half an entry is what a crash during an append leaves, so a run stopped here
    // whatever the rest of the file says. `resume` drops that line under the lock.
    throw new AlreadyCoordinatedError(
      `${ledgerPath} ends in half an entry, which is what a crash during an append leaves, so a run was interrupted here. resume drops that line under the lock and settles the call it may describe. ${recover}`,
    );
  }
  const started = entries.find((entry) => entry.kind === "run_started");
  if (started === undefined || started.kind !== "run_started") {
    if (entries.length === 0) {
      return null;
    }
    throw new AlreadyCoordinatedError(
      `${ledgerPath} holds ${plural(entries.length, "line")} and none of them opens a run, so nothing in it says which coordination those lines belong to. Point run at a new file. Nothing was dialled.`,
    );
  }
  if (started.request_digest !== requestDigest(request)) {
    throw new AlreadyCoordinatedError(
      `${ledgerPath} was written from a different request, so it is another coordination's durable state and every call it records belongs to that one. A ledger holds one coordination: point this run at a new file. Nothing was dialled.`,
    );
  }
  const closing = [...entries].reverse().find((entry) => entry.kind === "outcome");
  if (closing === undefined || closing.kind !== "outcome") {
    throw new AlreadyCoordinatedError(
      `${ledgerPath} records this coordination and no entry closes it, so the run did not finish and this is a recovery rather than a new run. resume settles every call under the key the ledger recorded for it and places the release calls that are owed, where a second run derives a new key for each one and rings everybody again. ${recover}`,
    );
  }
  const state = inspectLedger(entries);
  const outstanding = [
    ...state.unsettled.map((result) => `${result.party_id}'s ${result.phase} call is not settled`),
    ...state.owedReleases.map((party) => `${party} is still owed a release call`),
  ];
  if (outstanding.length > 0) {
    throw new AlreadyCoordinatedError(
      `${ledgerPath} records this coordination as ${closing.outcome} with work still outstanding: ${outstanding.join(", ")}. That work is resume's, because a call is settled under the key it went out under and a release call that is owed is the one call this app may place a second time. ${recover}`,
    );
  }
  // The checks above establish a shape: a closing outcome, no unsettled call and no
  // owed release. They do not establish that the outcome the file records is the one
  // its own answers imply. `inspectLedger` trusts `closing.outcome`, so a ledger that
  // says verbally_confirmed with a party never credited, a slot the answers do not
  // choose or a call count that does not match its entries would pass everything above
  // and be handed back as a success with nothing dialled. `replay` is the check a plain
  // reading cannot do: it re-derives the feasible set, the chosen slot, the credits and
  // the call count and reports every place the history does not support the outcome. It
  // runs here, after the outstanding check, so an interrupted-but-valid ledger has
  // already gone to `resume` and anything replay still finds is a real inconsistency in
  // a file that claims to be finished. That case is refused, not returned and not
  // resumed. A gather call attempted with no result behind it lands here too: it is not
  // in the outstanding list (a gather orphan is nobody's to finish, resume never gathers
  // again) but replay flags it as an open attempt, so a ledger whose outcome may rest on
  // a gather call that was live is refused rather than trusted. Fail closed.
  const verification = replay(entries);
  if (!verification.ok) {
    const problems = verification.issues
      .map((issue) => `entry ${issue.entry}: ${issue.problem}`)
      .join("; ");
    throw new AlreadyCoordinatedError(
      `${ledgerPath} records this coordination as ${closing.outcome}, but a replay of the ledger does not support that: ${problems}. A completed ledger is handed back only when a replay of it agrees with the recorded outcome, so this run will not return a result the history contradicts. An inconsistency like this in a finished ledger is not an interrupted call for resume to settle, it is a history a person has to read. Nothing was dialled.`,
    );
  }
  progress(
    `${ledgerPath} already records this coordination as ${closing.outcome} and every call in it is settled, so nothing was dialled and the recorded outcome is what this run returns.`,
  );
  // The returned result is built the way a live run builds it, from the request and the
  // outcome kind, not lifted whole off the entry. Replay above already refuses a ledger
  // whose confirmed_with, unreleased, slot_id or calls_placed does not match the derived
  // history, so by here they agree. Rebuilding the request-bound fields the same way
  // `coordinate` does keeps the two return paths identical and means a field can only
  // ever leave here in the shape the protocol gives it: a verbal confirmation names the
  // slot and every party, any other outcome names no slot and confirms nobody. slot_id
  // is the one field replay does not check outside verbally_confirmed, so deriving it
  // here rather than trusting the entry is what closes that last gap. unreleased and
  // calls_placed are lifted, which is safe because replay proved each equals the derived
  // value: a call this run did not place cannot be recounted and the owed set was pinned
  // on both sides.
  const isConfirmed = closing.outcome === "verbally_confirmed";
  const slotId = isConfirmed ? closing.slot_id : null;
  const slot = slotId === null ? undefined : slotById(request.slots, slotId);
  return {
    request_id: request.requestId,
    outcome: closing.outcome,
    slot_id: slotId,
    slot_spoken: slot?.spoken ?? null,
    confirmed_with: isConfirmed ? request.parties.map((party) => party.id) : [],
    unreleased: closing.unreleased,
    // The recorded count, not a fresh one. This run placed nothing, so claiming a
    // call of its own would be a second call in the accounting and none on a phone.
    calls_placed: closing.calls_placed,
    calls_saved: Math.max(worstCaseCalls(request) - closing.calls_placed, 0),
    note: `${closing.note}; read from the ledger, which already records this coordination, so this run placed no call`,
    ledger_path: ledgerPath,
  };
}

/** The exact body one call sends. The idempotency key is a digest of this. */
export function callInput(
  request: CoordinationRequest,
  party: Party,
  phase: Phase,
  slot: Slot | undefined,
  task: string,
  schema: JsonSchema,
): CreateCallInput {
  return {
    task,
    recipients: [
      {
        phones: [party.phone],
        ...(party.region === undefined ? {} : { region: party.region }),
        ...(party.locale === undefined ? {} : { locale: party.locale }),
      },
    ],
    resultSchema: schema,
    metadata: metadata(request, phase, party, slot),
  };
}

export interface PlaceOptions {
  request: CoordinationRequest;
  port: CallePort;
  party: Party;
  phase: Phase;
  slot: Slot | undefined;
  task: string;
  schema: JsonSchema;
  timeoutMs: number;
  pollIntervalMs: number;
  signal?: AbortSignal;
  /**
   * The key to send, when one is already known. `resume` passes the key the
   * ledger recorded for the call it is settling, so recovery re-issues the exact
   * string the lost create used instead of rebuilding one. Omitted on a fresh
   * call, which is where the key is derived.
   */
  key?: string;
  /**
   * Which attempt at this call it is, when the key is being derived here. The number
   * the ledger licenses, which `attemptToMint` decides, so a retry is a call the
   * provider has never seen rather than a replay of the one it has and a call the
   * ledger has already answered gets no new key at all. Ignored when `key` is given:
   * that string already belongs to an attempt.
   */
  attempt?: number;
  /**
   * Appends to the ledger. This function writes the attempt record before the
   * create and the accepted call id before anything waits on the call, so the
   * window between CALL-E accepting a call and the caller recording what it did
   * is no longer a window with nothing on disk. A caller with no ledger leaves it
   * out and those two lines are simply not written.
   */
  record?: (entry: LedgerEntry) => void;
  /**
   * The run's clock, so those two entries are stamped from the same clock as the
   * phase entry beside them. The demo pins a clock and commits the ledger it
   * produced, so reading the wall clock here would move a committed file on every
   * run.
   */
  now?: () => number;
}

async function waitOrAbort(
  port: CallePort,
  callId: string,
  wait: { timeoutMs: number; intervalMs: number },
  signal: AbortSignal | undefined,
): Promise<CallSnapshot> {
  const waiting = port.waitForResult(callId, wait);
  if (signal === undefined) {
    return waiting;
  }
  if (signal.aborted) {
    throw new Aborted();
  }
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Aborted()), { once: true });
  });
  return Promise.race([waiting, aborted]);
}

function asCallError(error: unknown): CalleCallError {
  return error instanceof CalleCallError ? error : new CalleCallError("sdk_error", String(error));
}

/**
 * Create one call and wait for it. Shared by a fresh run and by `resume`, so both
 * send the same body under the same idempotency key and a resumed call is the
 * same call rather than a second one.
 *
 * Every failure is sorted into one of two kinds. A refusal the server chose to
 * send on the first attempt means no call exists, so it comes back as a plain
 * error code and the caller may carry on. Anything that leaves the call unknown,
 * so no reply, a timeout, a rate limit, a conflict on the key, a server error, a
 * read that failed after the create got through or a call CALL-E has not
 * finished with, comes back `unresolved` with whatever call id is known.
 *
 * The first thing tried on an ambiguous create is the same key again: that hands
 * back the call CALL-E already holds for it and can never ring a second time.
 * Getting the call back is the only thing that resolves the ambiguity. A second
 * failure of any class, definite ones included, stays `unresolved`, because a
 * refusal can be decided before the idempotency lookup and says nothing about
 * the request that went unanswered.
 *
 * The key is derived here only on a fresh call. `resume` passes the one the
 * ledger recorded, because the derived key depends on the task text and the task
 * text lives in this repo rather than in the request: a run that crashed, an
 * upgrade, then a resume would derive a different key and place a second call to
 * somebody whose first call may still be live. Whichever way it arrives, the key
 * goes onto the outcome so the ledger records what went on the wire.
 *
 * Two ledger lines are written from in here, before the caller can write anything.
 * The attempt record carries the exact key, the attempt number it belongs to, a
 * digest of the payload it was taken over and the provider origin and account it is
 * being sent to. It lands before the create. The accepted record carries the id
 * CALL-E returned and it lands before anything waits on the call. Between those
 * two moments a process death used to leave no trace of a call that had already
 * been accepted, so nothing named it and nothing could settle it.
 *
 * No create is issued once the signal has fired, the reconciliation included. The
 * two cases are not the same, so they are not recorded the same. Before the first
 * create nothing has been sent, so no key is claimed and the call reads as never
 * placed. Before the reconciliation the first request may already have been
 * accepted, so the call comes back unresolved under its key rather than written off.
 * Creating it there would be a call placed after the run was canceled.
 */
export async function placeCall(options: PlaceOptions): Promise<CallOutcome> {
  const { request, port, party, phase, slot } = options;
  const input = callInput(request, party, phase, slot, options.task, options.schema);
  const key = options.key ?? idempotencyKey(request, phase, party, slot, input, options.attempt ?? 1);
  const record = options.record ?? ((): void => {});
  const now = options.now ?? ((): number => Date.now());
  const stamp = (): string => new Date(now()).toISOString();
  /** Read fresh every time. The signal can fire between any two lines below. */
  const canceled = (): boolean => options.signal?.aborted === true;
  if (canceled()) {
    // Nothing has gone out, so nothing is claimed under this key and there is
    // nothing for recovery to settle.
    return { call: null, callId: null, idempotencyKey: null, errorCode: "canceled", unresolved: false };
  }
  // Before the create, so the key exists on disk before it can have been used. One
  // record per call: an ambiguous create re-issues the same key with the same
  // payload, which is the same attempt.
  record({
    kind: "call_attempt",
    at: stamp(),
    phase,
    party_id: party.id,
    phone_masked: maskPhone(party.phone),
    slot_id: slot?.id ?? null,
    attempt: options.attempt ?? 1,
    idempotency_key: key,
    payload_digest: digestOf(input),
    provider_origin: port.origin ?? null,
    provider_account: port.account ?? null,
  });
  let callId: string | null = null;
  try {
    callId = (await port.createCall(input, key)).id;
  } catch (error) {
    const problem = asCallError(error);
    if (!problem.ambiguous) {
      return { call: null, callId: null, idempotencyKey: key, errorCode: problem.code, unresolved: false };
    }
    if (canceled()) {
      // The reconciliation would be a create and the first request may never have
      // landed, so it could start the call this cancellation was meant to stop. The
      // call stays this app's to account for, under the key on disk.
      return {
        call: null,
        callId: null,
        idempotencyKey: key,
        errorCode: `${problem.code}, then canceled`,
        unresolved: true,
      };
    }
    try {
      callId = (await port.createCall(input, key)).id;
    } catch (secondError) {
      // Only getting the call back resolves this. The first request may already
      // have been accepted, and a definite refusal here can be decided before
      // the idempotency lookup ever happens, so it is no evidence that no call
      // exists. Whatever the second answer is, the call stays unaccounted for.
      return {
        call: null,
        callId: null,
        idempotencyKey: key,
        errorCode: `${problem.code}, then ${asCallError(secondError).code}`,
        unresolved: true,
      };
    }
  }
  // Before the wait, so a crash while the call is running leaves an id recovery
  // can read rather than a key it has to re-issue.
  record({ kind: "call_accepted", at: stamp(), idempotency_key: key, call_id: callId });

  const settle = (call: CallSnapshot, errorCode: string | null): CallOutcome => ({
    call,
    callId: call.id,
    idempotencyKey: key,
    // A call CALL-E has not finished with is not an answer. Its transcript is
    // still being written, so reading one as a result is how a call that is still
    // ringing gets scored as somebody agreeing to a time.
    errorCode: errorCode ?? (TERMINAL_STATUSES.has(call.status) ? null : "not_finished"),
    unresolved: !TERMINAL_STATUSES.has(call.status),
  });
  const read = async (errorCode: string): Promise<CallOutcome> => {
    try {
      return settle(await port.getCall(callId), errorCode);
    } catch (error) {
      // The call was created and its state cannot be read, so it stays open.
      return {
        call: null,
        callId,
        idempotencyKey: key,
        errorCode: `${errorCode}, then ${asCallError(error).code}`,
        unresolved: true,
      };
    }
  };

  try {
    return settle(
      await waitOrAbort(
        port,
        callId,
        { timeoutMs: options.timeoutMs, intervalMs: options.pollIntervalMs },
        options.signal,
      ),
      null,
    );
  } catch (error) {
    if (error instanceof CalleWaitTimeout) {
      return read("timed_out");
    }
    if (error instanceof Aborted) {
      // The call is still running and the API has no cancel. Record what it looks
      // like now and let `resume` settle it, rather than guessing an answer.
      return read("canceled");
    }
    return read(asCallError(error).code);
  }
}

function readIntArray(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const options = new Set<number>();
  for (const item of value) {
    const option = typeof item === "number" ? item : Number(item);
    if (Number.isInteger(option) && option >= 1 && option <= max) {
      options.add(option);
    }
  }
  return [...options].sort((left, right) => left - right);
}

function structuredOf(call: CallSnapshot): Record<string, unknown> | null {
  return call.structuredResult ?? call.recipients[0]?.structuredResult ?? null;
}

function lastAttempt(call: CallSnapshot | null) {
  return call?.recipients[0]?.attempts.at(-1) ?? null;
}

function sameOptions(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((option, index) => option === right[index]);
}

/**
 * The status to record for a call.
 *
 * A call nobody can account for gets this app's own `unresolved`, whatever else is
 * known about it. A create that never went out gets `not_placed`: no key reached
 * the provider and no id came back, so there is no call at CALL-E to settle. That
 * is the party's calling hours refusing the call and the run being canceled before
 * the create, which are the same thing from here.
 */
function statusOf(outcome: CallOutcome, known: string): string {
  if (outcome.unresolved) {
    return UNRESOLVED_STATUS;
  }
  if (outcome.callId === null && outcome.idempotencyKey === null) {
    return NOT_PLACED_STATUS;
  }
  return known;
}

function evaluateGather(
  request: CoordinationRequest,
  party: Party,
  feasible: Slot[],
  outcome: CallOutcome,
): GatherResult {
  const base = {
    party_id: party.id,
    phone_masked: maskPhone(party.phone),
    call_id: outcome.callId ?? outcome.call?.id ?? null,
    provider_call_id: lastAttempt(outcome.call)?.providerCallId ?? null,
    idempotency_key: outcome.idempotencyKey,
  };
  if (outcome.call === null) {
    return {
      ...base,
      call_status: statusOf(outcome, "api_error"),
      reached_person: false,
      machine_answered: false,
      structured_options: [],
      heard_options: [],
      available_options: [],
      none_work: false,
      disagreement: false,
      confidence: null,
      notes: outcome.errorCode ?? "call not created",
      transcript_excerpt: [],
      failure_code: outcome.errorCode,
    };
  }

  const call = outcome.call;
  const attempt = lastAttempt(call);
  const turns = attempt?.transcriptTurns ?? [];
  const reading = readGather(turns, request.slots);
  const structured = structuredOf(call);
  const structuredOptions =
    structured === null ? [] : readIntArray(structured.available_options, request.slots.length);
  const noneWork =
    reading.noneWork || (structured !== null && structured.none_work === "yes" && structuredOptions.length === 0);
  const machineAnswered = reading.machineAnswered && reading.heardOptions.length === 0;
  const reachedPerson = call.status === "completed" && reading.userTurnCount > 0 && !machineAnswered;
  const confidence = call.completionConfidence ?? null;
  const lowConfidence = confidence !== null && confidence.score < request.policy.minConfidence;

  let available: number[] = [];
  const notes: string[] = [];
  if (structured !== null && typeof structured.notes === "string" && structured.notes.length > 0) {
    notes.push(structured.notes);
  }
  if (reachedPerson && !lowConfidence) {
    if (structured === null) {
      // CALL-E could not extract a schema-valid result. The transcript is all
      // there is and it is better evidence than nothing.
      available = reading.heardOptions;
      notes.push("no extracted result, availability read from the transcript");
    } else {
      available = structuredOptions.filter((option) => reading.heardOptions.includes(option));
    }
  }
  if (lowConfidence) {
    notes.push(`completion confidence ${String(confidence?.score)} below ${request.policy.minConfidence}`);
  }
  const feasibleOptions = new Set(feasible.map((slot) => slot.option));
  available = available.filter((option) => feasibleOptions.has(option));
  const disagreement =
    structured !== null && reachedPerson && !sameOptions(structuredOptions, reading.heardOptions);
  if (disagreement) {
    notes.push(
      `extracted options ${structuredOptions.join("/") || "none"} and heard options ${reading.heardOptions.join("/") || "none"} disagree, kept the overlap`,
    );
  }

  if (outcome.unresolved) {
    notes.push(`CALL-E last had this call as ${call.status || "no status"}, so it is not an answer`);
  }

  return {
    ...base,
    call_status: statusOf(outcome, call.status),
    reached_person: reachedPerson,
    machine_answered: machineAnswered,
    structured_options: structuredOptions,
    heard_options: reading.heardOptions,
    available_options: available,
    none_work: noneWork && available.length === 0,
    disagreement,
    confidence,
    notes: notes.join("; "),
    transcript_excerpt: reading.excerpt,
    failure_code: outcome.unresolved
      ? outcome.errorCode
      : (attempt?.failureCode ?? call.failureCode ?? null),
  };
}

/**
 * Read one confirm or release call.
 *
 * `window` is the coordination window this call belongs to, which a confirm
 * result is judged against once it comes back. A release call is not governed by
 * the window, so it passes null: telling somebody the time is off is a duty and
 * it does not expire because a timer did.
 */
export function evaluateCommit(
  request: CoordinationRequest,
  party: Party,
  slot: Slot,
  phase: Phase,
  outcome: CallOutcome,
  window: WindowSpan | null,
): CommitResult {
  const base = {
    party_id: party.id,
    phone_masked: maskPhone(party.phone),
    phase,
    slot_id: slot.id,
    call_id: outcome.callId ?? outcome.call?.id ?? null,
    provider_call_id: lastAttempt(outcome.call)?.providerCallId ?? null,
    idempotency_key: outcome.idempotencyKey,
  };
  const verdict = (completedAt: unknown): WindowVerdict =>
    phase === "release"
      ? {
          within: true,
          reason: null,
          completionTimeUsable: completionInstant(completedAt) !== null,
        }
      : window === null
        ? {
            within: false,
            reason: "no_window",
            completionTimeUsable: completionInstant(completedAt) !== null,
          }
        : judgeWindow({ ...window, completedAt });
  if (outcome.call === null) {
    const missing = verdict(undefined);
    return {
      ...base,
      call_status: statusOf(outcome, "api_error"),
      confirmed: false,
      declined: false,
      acknowledged: false,
      within_window: missing.within,
      window_reason: missing.reason,
      completion_time_usable: missing.completionTimeUsable,
      question_asked: false,
      reached_person: false,
      machine_answered: false,
      structured_answer: null,
      heard_answer: null,
      disagreement: false,
      confidence: null,
      transcript_excerpt: [],
      failure_code: outcome.errorCode,
    };
  }

  const call = outcome.call;
  const attempt = lastAttempt(call);
  const turns = attempt?.transcriptTurns ?? [];
  const reading = phase === "release" ? readRelease(turns) : readConfirm(turns);
  const structured = structuredOf(call);
  const structuredAnswer =
    structured === null
      ? null
      : typeof structured.answer === "string"
        ? structured.answer
        : typeof structured.acknowledged === "string"
          ? structured.acknowledged
          : null;
  const machineAnswered = reading.machineAnswered;
  const reachedPerson = call.status === "completed" && reading.userTurnCount > 0 && !machineAnswered;
  const confidence = call.completionConfidence ?? null;
  const lowConfidence = confidence !== null && confidence.score < request.policy.minConfidence;

  const declined = reading.answer === "decline" || structuredAnswer === "decline";
  // Late is not confirmed. The person may well have said yes. This run can no
  // longer act on it, so the yes leaves a release call owed instead.
  const window_ = verdict(call.completedAt ?? attempt?.completedAt ?? null);
  const withinWindow = window_.within;
  const confirmed =
    phase === "confirm" &&
    withinWindow &&
    reachedPerson &&
    !lowConfidence &&
    reading.answer === "confirm" &&
    structuredAnswer !== "decline";
  // A release call is delivered only when the person on the line acknowledged it.
  // The transcript leads, exactly as it does for a commitment. The extracted
  // answer can veto that but never create it. An extraction the recording does not
  // support is not somebody being told their afternoon is free again. It is also
  // the one boolean that writes off a debt.
  const acknowledged =
    phase === "release" && reachedPerson && reading.answer === "confirm" && structuredAnswer !== "no";

  return {
    ...base,
    call_status: statusOf(outcome, call.status),
    confirmed,
    declined,
    acknowledged,
    within_window: withinWindow,
    window_reason: window_.reason,
    completion_time_usable: window_.completionTimeUsable,
    question_asked: reading.questionAsked,
    reached_person: reachedPerson,
    machine_answered: machineAnswered,
    structured_answer: structuredAnswer,
    heard_answer: reading.answer,
    disagreement: phase === "confirm" && reading.answer === "confirm" && structuredAnswer === "decline",
    confidence,
    transcript_excerpt: reading.excerpt,
    failure_code: outcome.unresolved
      ? outcome.errorCode
      : (attempt?.failureCode ?? call.failureCode ?? null),
  };
}

/** The refusals the window itself is responsible for. */
const WINDOW_REFUSALS = new Set(["late_result", "outside_window"]);

/**
 * Why a yes on the phone was not credited as a confirmation.
 *
 * Read off the result rather than assumed, so a run reports the check that
 * actually refused the answer. Only a window check may be reported as an expired
 * window. A yes refused for want of a readable completion time, by the confidence
 * floor or on a call CALL-E marked failed is not a timer running out. A record
 * that said so would name a check that never happened.
 */
function whyNotCredited(request: CoordinationRequest, result: CommitResult): string {
  if (result.window_reason !== null) {
    return result.window_reason;
  }
  if (result.declined) {
    return "extracted_decline";
  }
  if (result.confidence !== null && result.confidence.score < request.policy.minConfidence) {
    return "low_confidence";
  }
  if (!result.reached_person) {
    return `call_${result.call_status}`;
  }
  return "not_credited";
}

export interface ReleaseRoundOptions {
  request: CoordinationRequest;
  port: CallePort;
  slot: Slot;
  /** Who is owed a release call, in the order to call them. */
  parties: Party[];
  callsPlaced: number;
  pollIntervalMs: number;
  now: () => number;
  progress: (line: string) => void;
  record: (entry: LedgerEntry) => void;
  /**
   * Every entry the ledger holds, including the ones this round appends.
   *
   * A release call is the one call this app places more than once, so it is the one
   * that needs to know what came before. The history decides two things: which
   * attempt this is, which goes into the key and makes the retry a call the provider
   * has never seen and whether the last attempt is accounted for at all. A caller
   * with no ledger passes an empty list and gets attempt 1, which is all a run
   * without durable state can honestly claim.
   */
  history: LedgerEntry[];
  /**
   * Whether a retry was asked for. Off unless something says otherwise.
   *
   * A first release call to somebody is this round finishing what the coordination
   * owed. A second one is a retry: the key is new, so it is a phone ringing again
   * rather than a lookup, and it goes out only when somebody asked for it and the
   * last attempt is settled. A fresh coordination never sets this, because it has no
   * earlier attempt to retry. `resume --retry-release` sets it.
   */
  retryAuthorized?: boolean;
}

export interface ReleaseRoundResult {
  callsPlaced: number;
  unreleased: string[];
}

/**
 * Tell everybody who said yes that it is off.
 *
 * The coordination window does not apply here: telling somebody their afternoon
 * is free again is a duty and it does not expire because a timer did. The call
 * budget and the party's calling hours do apply and a party who cannot be called
 * inside either is reported as still owed the call rather than rung at 3am. The
 * same round runs from a fresh coordination and from `resume`.
 *
 * This is the only call the app places twice, so it is the only one with an attempt
 * number that moves. A release call that ended without reaching a person leaves the
 * debt owed and the retry has to be a call the provider has never seen: the key is
 * otherwise identical, so CALL-E would answer with the call that reached the machine
 * and nothing would ring. That is also why a retry is not automatic. A new key rings
 * a phone, so it goes out only once somebody asked for it and the last attempt's
 * outcome is known. While one is unaccounted for, the person stays owed and recovery
 * reconciles that attempt under its own key, because a second call to somebody who
 * may be on the first one is the mistake this whole protocol exists to avoid. Both
 * conditions are one rule in `attemptToMint`, asked here rather than in the callers,
 * because a fresh coordination and a resume both place release calls and only one of
 * them reads the ledger first.
 */
export async function releaseRound(options: ReleaseRoundOptions): Promise<ReleaseRoundResult> {
  const { request, port, slot } = options;
  let calls = options.callsPlaced;
  const unreleased: string[] = [];
  for (const party of options.parties) {
    if (calls >= request.policy.maxCalls) {
      options.progress(`  ${party.id} is still owed a release call, the call budget is spent.`);
      unreleased.push(party.id);
      continue;
    }
    const minted = attemptToMint(
      options.history,
      "release",
      party.id,
      slot.id,
      options.retryAuthorized === true,
    );
    if (minted.attempt === null) {
      options.progress(`  ${party.id} is still owed a release call, ${minted.refusal}.`);
      unreleased.push(party.id);
      continue;
    }
    const at = options.now();
    if (!withinCallingHours(party.callingHours, at)) {
      options.progress(
        `  ${party.id} is still owed a release call, ${clockOf(at, party.callingHours.timezone)} is outside ${party.callingHours.start} to ${party.callingHours.end} ${party.callingHours.timezone}.`,
      );
      unreleased.push(party.id);
      continue;
    }
    calls += 1;
    const outcome = await placeCall({
      request,
      port,
      party,
      phase: "release",
      slot,
      task: releaseTask(request, party, slot),
      schema: releaseSchema(),
      timeoutMs: Math.max(request.policy.perCallTimeoutSeconds * 1000, 1_000),
      pollIntervalMs: options.pollIntervalMs,
      record: options.record,
      now: options.now,
      attempt: minted.attempt,
    });
    const result = evaluateCommit(request, party, slot, "release", outcome, null);
    options.record({ kind: "release", at: new Date(at).toISOString(), result });
    if (!result.acknowledged) {
      unreleased.push(party.id);
    }
    options.progress(`  released ${party.id}${result.acknowledged ? "" : " (no person on the line, follow up)"}.`);
  }
  return { callsPlaced: calls, unreleased };
}

/**
 * Run the protocol. One writer per ledger: the lock is held for the whole run, so
 * a second process cannot interleave its lines into the same history. The lock is
 * taken before the file is read, so the check that this coordination is not already
 * recorded in it happens where nothing else can be appending.
 */
export async function runCoordination(options: RunOptions): Promise<RunResult> {
  assertDurableState(options.port, options.ledgerPath ?? null);
  const lock = options.ledgerPath == null ? null : acquireLedgerLock(options.ledgerPath);
  try {
    return await coordinate(options);
  } finally {
    lock?.release();
  }
}

async function coordinate(options: RunOptions): Promise<RunResult> {
  const { request, port } = options;
  const now = options.now ?? (() => Date.now());
  const progress = options.onProgress ?? (() => {});
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const ledgerPath = options.ledgerPath ?? null;
  const windowStart = now();
  const deadline = windowStart + request.policy.windowMinutes * 60_000;

  /**
   * A coordination this ledger already records is not started again.
   *
   * Read before anything is dialled and under the run's lock. Either this run may
   * append to the file or it may not, and when it may not the answer is on disk
   * already or it belongs to `resume`.
   */
  if (ledgerPath !== null) {
    const stored = readLedger(ledgerPath);
    const recorded = recordedRound(request, ledgerPath, stored.entries, stored.truncatedTail, progress);
    if (recorded !== null) {
      return recorded;
    }
  }

  /**
   * Everything this run appends, which for a fresh coordination is everything the
   * ledger holds.
   *
   * It used to start from the file, because the attempt number for a call is counted
   * from the history and a run appending to a ledger that already records a release
   * call must not derive the key that call used. The file is empty by the time this
   * line runs now: a run that finds a coordination in it returns or refuses above
   * rather than opening a second round, which is what stopped it deriving a fresh key
   * for every call the round already held. What is left is what this run writes,
   * which is what the release round reads to number its own attempts.
   */
  const history: LedgerEntry[] = [];
  const record = (entry: LedgerEntry): void => {
    history.push(entry);
    if (ledgerPath !== null) {
      appendEntry(ledgerPath, entry);
    }
  };
  const stamp = (): string => new Date(now()).toISOString();

  record({
    kind: "run_started",
    at: stamp(),
    request_id: request.requestId,
    request_digest: requestDigest(request),
    slots: request.slots,
    parties: request.parties.map((party) => party.id),
    policy: request.policy,
  });

  let calls = 0;
  const place = async (
    task: string,
    schema: JsonSchema,
    party: Party,
    phase: Phase,
    slot: Slot | undefined,
    ignoreWindow = false,
  ): Promise<CallOutcome> => {
    const at = now();
    const minted = attemptToMint(history, phase, party.id, slot?.id ?? null);
    if (minted.attempt === null) {
      // Asked before the hours check and before the budget, because this decides
      // whether the call may exist at all rather than when it may go out. A run only
      // ever appends to a fresh ledger, so the answer here is attempt 1 every time.
      // It is asked rather than assumed because the rule is one function and this is
      // one of the two places in the app that derive a key: the coordinator cannot
      // mint a second attempt at a call even if it is one day reached with a history
      // the check above did not see. No key was used, so the entry records none.
      progress(`  ${party.id}: not called, ${minted.refusal}.`);
      return { call: null, callId: null, idempotencyKey: null, errorCode: "already_attempted", unresolved: false };
    }
    if (!withinCallingHours(party.callingHours, at)) {
      // No call is placed, so this costs nothing from the budget. It is not a
      // failure either: the person simply may not be rung at this hour. No key
      // was used, so the entry records none: there is nothing to reconcile.
      progress(
        `  ${party.id}: not called, ${clockOf(at, party.callingHours.timezone)} is outside ${party.callingHours.start} to ${party.callingHours.end} ${party.callingHours.timezone}.`,
      );
      return { call: null, callId: null, idempotencyKey: null, errorCode: "outside_calling_hours", unresolved: false };
    }
    const remaining = ignoreWindow ? request.policy.perCallTimeoutSeconds * 1000 : deadline - at;
    const timeoutMs = Math.max(
      Math.min(request.policy.perCallTimeoutSeconds * 1000, remaining),
      1_000,
    );
    calls += 1;
    const outcome = await placeCall({
      request,
      port,
      party,
      phase,
      slot,
      task,
      schema,
      timeoutMs,
      pollIntervalMs,
      record,
      now,
      attempt: minted.attempt,
      // A release call is a duty. Cancelling the coordination does not cancel it.
      signal: phase === "release" ? undefined : options.signal,
    });
    if (outcome.call === null && outcome.errorCode !== null) {
      progress(`CALL-E returned ${outcome.errorCode} for ${party.id}.`);
    }
    return outcome;
  };

  let feasible: Slot[] = request.slots;
  let stopped: Outcome | null = null;
  let lastGather: GatherResult | null = null;
  /** The call that stopped the run because nobody can say what it is doing. */
  let openCall: string | null = null;
  let gatherNote = "";

  const nameOpenCall = (partyId: string, phase: Phase, callId: string | null, why: string | null): string => {
    openCall = callId;
    return `${partyId}'s ${phase} call may still be live (${why ?? "no answer from CALL-E"}), ${
      callId === null
        ? "and CALL-E returned no call id"
        : `reconcile ${callId}`
    } before anybody else is called${phase === "gather" ? ", by hand: resume settles confirm and release calls only" : " and run resume"}`;
  };

  for (const party of request.parties) {
    if (options.signal?.aborted === true) {
      stopped = "canceled";
      break;
    }
    if (now() >= deadline) {
      stopped = "window_expired";
      break;
    }
    if (calls >= request.policy.maxCalls) {
      stopped = "budget_exhausted";
      break;
    }
    progress(`Asking ${party.name} (${party.role}) about ${plural(feasible.length, "option")}.`);
    const outcome = await place(
      gatherTask(request, party, feasible),
      gatherSchema(request.slots.length),
      party,
      "gather",
      undefined,
    );
    const before = feasible.map((slot) => slot.id);
    const result = evaluateGather(request, party, feasible, outcome);
    lastGather = result;
    if (outcome.unresolved) {
      // The call may be on the phone to somebody right now. It says nothing about
      // availability, so the feasible set does not move and nobody else is rung.
      record({ kind: "gather", at: stamp(), feasible_before: before, result, feasible_after: before });
      stopped = "unresolved";
      gatherNote = nameOpenCall(party.id, "gather", result.call_id, result.failure_code);
      progress(`  ${party.id}: ${gatherNote}.`);
      break;
    }
    const after = result.reached_person ? intersect(feasible, result.available_options) : [];
    record({ kind: "gather", at: stamp(), feasible_before: before, result, feasible_after: after.map((slot) => slot.id) });
    progress(
      `  ${party.id}: ${
        result.reached_person
          ? `can do ${result.available_options.length === 0 ? "none of them" : `option ${result.available_options.join(" and ")}`}`
          : result.machine_answered
            ? "machine answered"
            : `not reached (${result.failure_code ?? result.call_status})`
      }. ${plural(after.length, "option")} still open.`,
    );
    feasible = after;
    if (feasible.length === 0) {
      break;
    }
  }

  if (stopped === null && feasible.length === 0) {
    stopped = lastGather !== null && lastGather.reached_person ? "no_common_slot" : "not_reached";
  }

  const confirmedParties: Party[] = [];
  /**
   * Everybody who said yes on a confirm call, in the order they said it. This is
   * the release list. It is not the same as the list above: a yes the window
   * arrived too late for still leaves a person expecting an appointment.
   */
  const saidYesParties: Party[] = [];
  const unreleased: string[] = [];
  let chosen: Slot | null = null;
  let outcome: Outcome = stopped ?? "verbally_confirmed";
  let note = "";

  if (stopped === null) {
    chosen = chooseSlot(feasible);
    if (chosen === null) {
      outcome = "no_common_slot";
    } else {
      record({ kind: "slot_chosen", at: stamp(), slot_id: chosen.id, feasible: feasible.map((slot) => slot.id) });
      progress(`Everyone can do ${chosen.spoken}. Confirming it.`);
      for (const party of request.parties) {
        if (options.signal?.aborted === true) {
          outcome = "canceled";
          note = "canceled during confirmation";
          break;
        }
        if (calls >= request.policy.maxCalls) {
          outcome = "budget_exhausted";
          note = "ran out of call budget during confirmation";
          break;
        }
        if (now() >= deadline) {
          outcome = "window_expired";
          note = "the window closed during confirmation";
          break;
        }
        const commitOutcome = await place(
          confirmTask(request, party, chosen),
          confirmSchema(),
          party,
          "confirm",
          chosen,
        );
        const result = evaluateCommit(request, party, chosen, "confirm", commitOutcome, {
          windowStart,
          deadline,
          now: now(),
        });
        record({ kind: "commit", at: stamp(), result });
        if (saidYes(result)) {
          saidYesParties.push(party);
        }
        if (commitOutcome.unresolved) {
          // This call may still be asking somebody to agree to the time. Telling
          // the parties who already said yes that it is off, while a call that
          // could confirm it is live, is the one thing worse than stopping here.
          outcome = "unresolved";
          note = nameOpenCall(party.id, "confirm", result.call_id, result.failure_code);
          progress(`  ${party.id}: ${note}.`);
          break;
        }
        if (result.confirmed) {
          confirmedParties.push(party);
          progress(`  ${party.id}: confirmed.`);
          continue;
        }
        if (saidYes(result)) {
          // They said yes and this run cannot credit it. Nothing is arranged and
          // the person who said yes is told, which is the same duty as any other
          // run that does not go ahead. The refusal is named, so a call CALL-E
          // marked failed and an answer with no readable completion time are not
          // both filed as a window that closed.
          const refusal = whyNotCredited(request, result);
          const windowClosed = WINDOW_REFUSALS.has(refusal);
          outcome =
            commitOutcome.errorCode === "canceled"
              ? "canceled"
              : windowClosed
                ? "window_expired"
                : "not_confirmed";
          note = windowClosed
            ? `the window closed before ${party.id} answered, so nothing is going ahead`
            : `${party.id} said yes and it could not be credited (${refusal}), so nothing is going ahead`;
          progress(
            `  ${party.id}: said yes and it could not be credited (${refusal}). Nothing is going ahead, releasing everyone who said yes.`,
          );
          break;
        }
        outcome = commitOutcome.errorCode === "canceled" ? "canceled" : "not_confirmed";
        note = result.declined
          ? `${party.id} declined the time`
          : `${party.id} did not confirm (${result.failure_code ?? result.call_status})`;
        progress(`  ${party.id}: not confirmed. Releasing everyone who had confirmed.`);
        break;
      }
      if (outcome === "verbally_confirmed" && confirmedParties.length === request.parties.length) {
        note = `every party confirmed the time by voice, ${confirmedParties.length} of ${request.parties.length}`;
      }
    }
  } else {
    note =
      stopped === "no_common_slot"
        ? `no time works for everyone, ${lastGather?.party_id ?? "the last party"} ruled out the rest`
        : stopped === "unresolved"
          ? gatherNote
          : stopped === "not_reached"
            ? `${lastGather?.party_id ?? "a party"} could not be reached, so nothing was arranged`
            : stopped === "window_expired"
              ? "the window closed before every party answered"
              : stopped === "canceled"
                ? "canceled while gathering availability"
                : "ran out of call budget while gathering availability";
  }

  if (outcome === "unresolved") {
    // Nobody is called while a call may be live, and everybody who said yes is
    // named as owed so the debt survives into the ledger for `resume` to settle.
    unreleased.push(...saidYesParties.map((party) => party.id));
    if (saidYesParties.length > 0) {
      progress(
        `  ${plural(saidYesParties.length, "party")} said yes and ${saidYesParties.length === 1 ? "is" : "are"} still owed a call, which resume places once ${openCall ?? "that call"} is settled.`,
      );
    }
  } else if (chosen !== null && outcome !== "verbally_confirmed" && saidYesParties.length > 0) {
    const round = await releaseRound({
      request,
      port,
      slot: chosen,
      // Most recent yes first: that person changed their day most recently.
      parties: [...saidYesParties].reverse(),
      callsPlaced: calls,
      pollIntervalMs,
      now,
      progress,
      record,
      history,
    });
    calls = round.callsPlaced;
    unreleased.push(...round.unreleased);
  }

  const confirmedWith = outcome === "verbally_confirmed" ? request.parties.map((party) => party.id) : [];
  record({
    kind: "outcome",
    at: stamp(),
    outcome,
    slot_id: outcome === "verbally_confirmed" ? (chosen?.id ?? null) : null,
    confirmed_with: confirmedWith,
    unreleased,
    calls_placed: calls,
    note,
  });

  return {
    request_id: request.requestId,
    outcome,
    slot_id: outcome === "verbally_confirmed" ? (chosen?.id ?? null) : null,
    slot_spoken: outcome === "verbally_confirmed" ? (chosen?.spoken ?? null) : null,
    confirmed_with: confirmedWith,
    unreleased,
    calls_placed: calls,
    calls_saved: Math.max(worstCaseCalls(request) - calls, 0),
    note,
    ledger_path: ledgerPath,
  };
}
