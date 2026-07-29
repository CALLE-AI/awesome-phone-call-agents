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
 */

import { CalleCallError, CalleWaitTimeout, type CallePort } from "./calle.js";
import { worstCaseCalls } from "./config.js";
import { appendEntry, requestDigest } from "./ledger.js";
import { readConfirm, readGather, readRelease } from "./read.js";
import { chooseSlot, intersect } from "./slots.js";
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

interface CallOutcome {
  call: CallSnapshot | null;
  errorCode: string | null;
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

function evaluateGather(
  request: CoordinationRequest,
  party: Party,
  feasible: Slot[],
  outcome: CallOutcome,
): GatherResult {
  const base = {
    party_id: party.id,
    phone_masked: maskPhone(party.phone),
    call_id: outcome.call?.id ?? null,
    provider_call_id: lastAttempt(outcome.call)?.providerCallId ?? null,
  };
  if (outcome.call === null) {
    return {
      ...base,
      call_status: "api_error",
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

  return {
    ...base,
    call_status: call.status,
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
    failure_code: attempt?.failureCode ?? call.failureCode ?? null,
  };
}

function evaluateCommit(
  request: CoordinationRequest,
  party: Party,
  slot: Slot,
  phase: Phase,
  outcome: CallOutcome,
): CommitResult {
  const base = {
    party_id: party.id,
    phone_masked: maskPhone(party.phone),
    phase,
    slot_id: slot.id,
    call_id: outcome.call?.id ?? null,
    provider_call_id: lastAttempt(outcome.call)?.providerCallId ?? null,
  };
  if (outcome.call === null) {
    return {
      ...base,
      call_status: "api_error",
      confirmed: false,
      declined: false,
      acknowledged: false,
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
  const confirmed =
    phase === "confirm" &&
    reachedPerson &&
    !lowConfidence &&
    reading.answer === "confirm" &&
    structuredAnswer !== "decline";
  const acknowledged =
    phase === "release" && (reading.answer === "confirm" || structuredAnswer === "yes") && reachedPerson;

  return {
    ...base,
    call_status: call.status,
    confirmed,
    declined,
    acknowledged,
    reached_person: reachedPerson,
    machine_answered: machineAnswered,
    structured_answer: structuredAnswer,
    heard_answer: reading.answer,
    disagreement: phase === "confirm" && reading.answer === "confirm" && structuredAnswer === "decline",
    confidence,
    transcript_excerpt: reading.excerpt,
    failure_code: attempt?.failureCode ?? call.failureCode ?? null,
  };
}

export async function runCoordination(options: RunOptions): Promise<RunResult> {
  const { request, port } = options;
  const now = options.now ?? (() => Date.now());
  const progress = options.onProgress ?? (() => {});
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const ledgerPath = options.ledgerPath ?? null;
  const deadline = now() + request.policy.windowMinutes * 60_000;

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
    schema: ReturnType<typeof gatherSchema>,
    party: Party,
    phase: Phase,
    slot: Slot | undefined,
    ignoreWindow = false,
  ): Promise<CallOutcome> => {
    const remaining = ignoreWindow ? request.policy.perCallTimeoutSeconds * 1000 : deadline - now();
    const timeoutMs = Math.max(
      Math.min(request.policy.perCallTimeoutSeconds * 1000, remaining),
      1_000,
    );
    calls += 1;
    try {
      const created = await port.createCall(
        {
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
        },
        idempotencyKey(request, phase, party, slot),
      );
      try {
        return { call: await port.waitForResult(created.id, { timeoutMs, intervalMs: pollIntervalMs }), errorCode: null };
      } catch (error) {
        if (error instanceof CalleWaitTimeout) {
          return { call: await port.getCall(created.id), errorCode: "timed_out" };
        }
        throw error;
      }
    } catch (error) {
      const code = error instanceof CalleCallError ? error.code : "sdk_error";
      progress(`CALL-E returned ${code} for ${party.id}.`);
      return { call: null, errorCode: code };
    }
  };

  let feasible: Slot[] = request.slots;
  let stopped: Outcome | null = null;
  let lastGather: GatherResult | null = null;

  for (const party of request.parties) {
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
  const unreleased: string[] = [];
  let chosen: Slot | null = null;
  let outcome: Outcome = stopped ?? "booked";
  let note = "";

  if (stopped === null) {
    chosen = chooseSlot(feasible);
    if (chosen === null) {
      outcome = "no_common_slot";
    } else {
      record({ kind: "slot_chosen", at: stamp(), slot_id: chosen.id, feasible: feasible.map((slot) => slot.id) });
      progress(`Everyone can do ${chosen.spoken}. Confirming it.`);
      for (const party of request.parties) {
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
        const result = evaluateCommit(request, party, chosen, "confirm", commitOutcome);
        record({ kind: "commit", at: stamp(), result });
        if (result.confirmed) {
          confirmedParties.push(party);
          progress(`  ${party.id}: confirmed.`);
          continue;
        }
        outcome = "not_confirmed";
        note = result.declined
          ? `${party.id} declined the time`
          : `${party.id} did not confirm (${result.failure_code ?? result.call_status})`;
        progress(`  ${party.id}: not confirmed. Releasing everyone who had confirmed.`);
        break;
      }
      if (outcome === "booked" && confirmedParties.length === request.parties.length) {
        note = `booked with ${confirmedParties.length} parties`;
      }
    }
  } else {
    note =
      stopped === "no_common_slot"
        ? `no time works for everyone, ${lastGather?.party_id ?? "the last party"} ruled out the rest`
        : stopped === "not_reached"
          ? `${lastGather?.party_id ?? "a party"} could not be reached, so nothing was booked`
          : stopped === "window_expired"
            ? "the window closed before every party answered"
            : "ran out of call budget while gathering availability";
  }

  // A release call is a duty, not part of the booking window, so the window does
  // not block it. The call budget still does.
  if (outcome !== "booked" && chosen !== null && confirmedParties.length > 0) {
    for (const party of [...confirmedParties].reverse()) {
      if (calls >= request.policy.maxCalls) {
        unreleased.push(party.id);
        continue;
      }
      const releaseOutcome = await place(
        releaseTask(request, party, chosen),
        releaseSchema(),
        party,
        "release",
        chosen,
        true,
      );
      const result = evaluateCommit(request, party, chosen, "release", releaseOutcome);
      record({ kind: "release", at: stamp(), result });
      if (!result.acknowledged) {
        unreleased.push(party.id);
      }
      progress(`  released ${party.id}${result.acknowledged ? "" : " (no person on the line, follow up)"}.`);
    }
  }

  const bookedWith = outcome === "booked" ? request.parties.map((party) => party.id) : [];
  record({
    kind: "outcome",
    at: stamp(),
    outcome,
    slot_id: outcome === "booked" ? (chosen?.id ?? null) : null,
    booked_with: bookedWith,
    unreleased,
    calls_placed: calls,
    note,
  });

  return {
    request_id: request.requestId,
    outcome,
    slot_id: outcome === "booked" ? (chosen?.id ?? null) : null,
    slot_spoken: outcome === "booked" ? (chosen?.spoken ?? null) : null,
    booked_with: bookedWith,
    unreleased,
    calls_placed: calls,
    calls_saved: Math.max(worstCaseCalls(request) - calls, 0),
    note,
    ledger_path: ledgerPath,
  };
}
