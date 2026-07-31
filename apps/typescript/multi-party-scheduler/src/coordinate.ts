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
 */

import { CalleCallError, CalleWaitTimeout, type CallePort, type CreateCallInput } from "./calle.js";
import { ConfigError, worstCaseCalls } from "./config.js";
import { clockOf, withinCallingHours } from "./hours.js";
import { acquireLedgerLock, appendEntry, requestDigest } from "./ledger.js";
import { readConfirm, readGather, readRelease } from "./read.js";
import { chooseSlot, intersect } from "./slots.js";
import { TERMINAL_STATUSES, UNRESOLVED_STATUS } from "./call-state.js";
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
}

/**
 * Statuses a call can no longer move out of, and the status this app records for
 * a call it cannot account for. Both live in `call-state.ts` so the coordinator,
 * recovery and replay cannot drift apart on what finished means.
 */
export { TERMINAL_STATUSES, UNRESOLVED_STATUS } from "./call-state.js";

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
 */
export async function placeCall(options: PlaceOptions): Promise<CallOutcome> {
  const { request, port, party, phase, slot } = options;
  const input = callInput(request, party, phase, slot, options.task, options.schema);
  const key = idempotencyKey(request, phase, party, slot, input);
  let callId: string | null = null;
  try {
    callId = (await port.createCall(input, key)).id;
  } catch (error) {
    const problem = asCallError(error);
    if (!problem.ambiguous) {
      return { call: null, callId: null, errorCode: problem.code, unresolved: false };
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
        errorCode: `${problem.code}, then ${asCallError(secondError).code}`,
        unresolved: true,
      };
    }
  }

  const settle = (call: CallSnapshot, errorCode: string | null): CallOutcome => ({
    call,
    callId: call.id,
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

function statusOf(outcome: CallOutcome, known: string): string {
  if (outcome.unresolved) {
    return UNRESOLVED_STATUS;
  }
  return outcome.errorCode === "outside_calling_hours" ? "not_placed" : known;
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
  const acknowledged =
    phase === "release" && (reading.answer === "confirm" || structuredAnswer === "yes") && reachedPerson;

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
 * a second process cannot interleave its lines into the same history.
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

  const record = (entry: LedgerEntry): void => {
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
    if (!withinCallingHours(party.callingHours, at)) {
      // No call is placed, so this costs nothing from the budget. It is not a
      // failure either: the person simply may not be rung at this hour.
      progress(
        `  ${party.id}: not called, ${clockOf(at, party.callingHours.timezone)} is outside ${party.callingHours.start} to ${party.callingHours.end} ${party.callingHours.timezone}.`,
      );
      return { call: null, callId: null, errorCode: "outside_calling_hours", unresolved: false };
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
        if (saidYes(result) && !result.within_window) {
          // The answer came back too late to act on. Nothing is arranged and the
          // person who said yes is told, which is the same duty as any other run
          // that does not go ahead.
          outcome = "window_expired";
          note = `the window closed before ${party.id} answered, so nothing is going ahead`;
          progress(`  ${party.id}: said yes after the window closed. Nothing is going ahead, releasing everyone who said yes.`);
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
