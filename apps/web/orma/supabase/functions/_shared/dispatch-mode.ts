/**
 * T2.8 dry dispatch mode.
 *
 * This module deliberately has no CALL-E URL, key, or fetch dependency. The
 * live dispatcher hands it the already-serialized body, so dry mode can prove
 * exactly what it would have sent while being structurally unable to dial.
 *
 * The body a dry run records is a masked copy of those bytes. The exact body
 * carries the webhook secret and the callee's full number, and the run's owner
 * may read the recorded row.
 *
 * The recorded fixtures below are embedded rather than read from `testdata/`. A
 * deployed Edge Function bundles only the function directory, so a runtime read
 * of `testdata/` fails in production. A test in this module pins both recorded
 * copies against the committed files, so the two cannot drift apart without a
 * failure. The third rehearsal shape is the completed recording with CALL-E's
 * validation-failure status and no extract, and its own test pins that
 * derivation.
 */

import { RESULT_VALIDATION_FAILED, type CallTaskFixture } from "./fixtures.ts";
import type { IngestResult, TerminalCallSource } from "./ingest.ts";

export type DryRunFixtureName = "completed" | "failed" | "no_result";

/** Verbatim from `testdata/calle/call-completed.json`. */
export const DRY_RUN_COMPLETED_FIXTURE: CallTaskFixture = {
  "id": "call_tQA8nz1WGj9vfO30PxTosA",
  "object": "call_task",
  "status": "completed",
  "task": "You are Orma, calling Narayan for their daily two-minute check-in.\nBoth of you know you are a machine. Do not pretend otherwise, and do not apologise for it.\n\nOpen with what they do not know, then move on:\nYou've mentioned the dentist three times. It's been 34 days.\n\nThen walk what is open, briefly, not the whole list. These are the open items and their ids:\n- item_1: book the dentist\n- item_2: renew the passport\n- item_3: call Amma on Sunday\n\nAfter that, ask what is new and needs capturing. Never ask this first.\n\nThen offer the exit. Ask whether anything on the list should be dropped. If they want to drop\nsomething, agree cleanly. Do not argue, do not ask them to reconsider, and do not make them\njustify it.\n\nClose by confirming tomorrow at 08:00 and hang up. Target two minutes. Do not state any number\nthat was not given to you above.",
  "recipients": [
    {
      "id": "rcp_589c058793c26a87",
      "phones": [
        "+91XXXXXXXXXX"
      ],
      "locale": null,
      "region": null,
      "status": "completed",
      "structured_result": null,
      "summary": "The call connected with Narayan, but the daily check-in was not completed as requested. The bot skipped required parts of the check-in and treated unclear responses as captured items, so no automatic retry should be made unless you explicitly ask for one.",
      "attempts": [
        {
          "id": "att_6cd8c482fa8694d6",
          "phone": "+91XXXXXXXXXX",
          "status": "completed",
          "started_at": "2026-09-11T12:18:17.945260Z",
          "completed_at": "2026-09-11T12:19:43.309454Z",
          "summary": "The call connected with Narayan, but the daily check-in was not completed as requested. The bot skipped required parts of the check-in and treated unclear responses as captured items, so no automatic retry should be made unless you explicitly ask for one.",
          "transcript_turns": [
            {
              "offset_seconds": 0,
              "speaker": "bot",
              "text": "You\u2019ve mentioned the dentist three times."
            },
            {
              "offset_seconds": 2,
              "speaker": "bot",
              "text": "It\u2019s been 34 days."
            },
            {
              "offset_seconds": 12,
              "speaker": "bot",
              "text": "Hello, this is Orma."
            },
            {
              "offset_seconds": 17,
              "speaker": "user",
              "text": "Hi, who is this?"
            },
            {
              "offset_seconds": 18,
              "speaker": "bot",
              "text": "Sorry,"
            },
            {
              "offset_seconds": 18,
              "speaker": "bot",
              "text": "this is Orma, calling for your daily check-in."
            },
            {
              "offset_seconds": 27,
              "speaker": "user",
              "text": "Sorry, can you say that again?"
            },
            {
              "offset_seconds": 28,
              "speaker": "bot",
              "text": "Of course,"
            },
            {
              "offset_seconds": 29,
              "speaker": "bot",
              "text": "a quick update from Orma: you\u2019ve mentioned the dentist three times,"
            },
            {
              "offset_seconds": 33,
              "speaker": "bot",
              "text": "and it\u2019s been 34 days."
            },
            {
              "offset_seconds": 41,
              "speaker": "user",
              "text": "I will sort it out this week."
            },
            {
              "offset_seconds": 41,
              "speaker": "bot",
              "text": "Thanks, noted."
            },
            {
              "offset_seconds": 42,
              "speaker": "bot",
              "text": "What\u2019s new today that needs capturing?"
            },
            {
              "offset_seconds": 44,
              "speaker": "user",
              "text": "Continental."
            },
            {
              "offset_seconds": 49,
              "speaker": "bot",
              "text": "Okay,"
            },
            {
              "offset_seconds": 50,
              "speaker": "bot",
              "text": "\u201cContinental\u201d. Should I track that as a new item?"
            },
            {
              "offset_seconds": 53,
              "speaker": "user",
              "text": "Yes, add it please."
            },
            {
              "offset_seconds": 54,
              "speaker": "bot",
              "text": "Sure,"
            },
            {
              "offset_seconds": 55,
              "speaker": "bot",
              "text": "I have captured that."
            },
            {
              "offset_seconds": 62,
              "speaker": "user",
              "text": "Is that everything for today?"
            },
            {
              "offset_seconds": 62,
              "speaker": "bot",
              "text": "On the open list"
            },
            {
              "offset_seconds": 69,
              "speaker": "user",
              "text": "Nothing else from me."
            },
            {
              "offset_seconds": 70,
              "speaker": "bot",
              "text": "Great"
            },
            {
              "offset_seconds": 76,
              "speaker": "bot",
              "text": "Okay."
            },
            {
              "offset_seconds": 79,
              "speaker": "user",
              "text": "Bye."
            },
            {
              "offset_seconds": 80,
              "speaker": "bot",
              "text": "Talk tomorrow at 8 AM,"
            },
            {
              "offset_seconds": 82,
              "speaker": "bot",
              "text": "bye."
            }
          ],
          "provider_call_id": "15e93d57242241c8bfdbb639b1c2bee6",
          "failure_code": null,
          "failure_message": null
        }
      ]
    }
  ],
  "structured_result": {
    "captured_items": [
      {
        "text": "Continental",
        "evidence_offset_seconds": 44
      }
    ],
    "retired_items": [],
    "commitments": [],
    "mood": "unknown",
    "slot_change_requested": "no"
  },
  "summary": "The call connected with Narayan, but the daily check-in was not completed as requested. The bot skipped required parts of the check-in and treated unclear responses as captured items, so no automatic retry should be made unless you explicitly ask for one.",
  "task_completed": true,
  "completion_confidence": {
    "score": 0.82,
    "label": "high"
  },
  "evidence": [
    "Narayan answered and spoke with the bot.",
    "The bot did not clearly cover all open items or ask whether anything should be dropped.",
    "Some of Narayan\u2019s responses were unclear, but the bot still moved forward and closed the call."
  ],
  "metadata": {
    "purpose": "first real call",
    "orma_task": "T0.3"
  },
  "failure_code": null,
  "failure_message": null,
  "created_at": "2026-09-11T12:17:01.121313Z",
  "completed_at": "2026-09-11T12:20:18.143184Z"
};

/** Verbatim from `testdata/calle/call-failed.json`. */
export const DRY_RUN_FAILED_FIXTURE: CallTaskFixture = {
  "id": "call_jDAvO3ThAO5Fa2kBPCmV6A",
  "object": "call_task",
  "status": "failed",
  "task": "This is an authorised Orma fixture probe. If anyone answers, identify this as a test call, end immediately, and collect no information.",
  "recipients": [
    {
      "id": "rcp_d8ccfb9be0fe6d18",
      "phones": [
        "+XXXXXXXXXXXX"
      ],
      "locale": null,
      "region": null,
      "status": "failed",
      "structured_result": null,
      "summary": "The call attempt did not connect; nobody answered. Because the fixture probe explicitly instructed us to report that outcome if the call could not be completed, no follow-up is needed.",
      "attempts": [
        {
          "id": "att_1fe65c06c33772d2",
          "phone": "+XXXXXXXXXXXX",
          "status": "failed",
          "started_at": "2026-09-11T13:21:39Z",
          "completed_at": "2026-09-11T13:21:39Z",
          "summary": "The call attempt did not connect; nobody answered. Because the fixture probe explicitly instructed us to report that outcome if the call could not be completed, no follow-up is needed.",
          "transcript_turns": [],
          "provider_call_id": "2fb9d10cf56546e0ac13086ff538f606",
          "failure_code": "408",
          "failure_message": null
        }
      ]
    }
  ],
  "structured_result": null,
  "summary": "The call attempt did not connect; nobody answered. Because the fixture probe explicitly instructed us to report that outcome if the call could not be completed, no follow-up is needed.",
  "task_completed": true,
  "completion_confidence": {
    "score": 0.9,
    "label": "high"
  },
  "evidence": [
    "The call status was reported as no answer.",
    "There was no transcript or callee speech from the attempt.",
    "The call duration was 0 seconds."
  ],
  "metadata": {
    "purpose": "bounded failed-terminal fixture probe",
    "orma_task": "T1.4"
  },
  "failure_code": "call_failed",
  "failure_message": "calling task status=NO ANSWER (Hangup by: bot)",
  "created_at": "2026-09-11T13:20:57.488383Z",
  "completed_at": "2026-09-11T13:24:02.913040Z"
};

/**
 * The shape a call whose result failed validation reports, which is the shape
 * that lands a run in the `no_result` terminal state. It is the completed
 * recording with two fields changed. `status` becomes CALL-E's status for that
 * case, and `structured_result` becomes null because there is no extract. The
 * transcript and the call identity stay, so the rehearsal exercises the same
 * ingestion path a real call would.
 */
export const DRY_RUN_NO_RESULT_FIXTURE: CallTaskFixture = {
  ...DRY_RUN_COMPLETED_FIXTURE,
  status: "result_validation_failed",
  structured_result: null,
};

/** The chosen fixture. Completed is the default, because it exercises capture. */
export function dryRunFixture(
  name: DryRunFixtureName = "completed",
): CallTaskFixture {
  if (name === "failed") return DRY_RUN_FAILED_FIXTURE;
  if (name === "no_result") return DRY_RUN_NO_RESULT_FIXTURE;
  return DRY_RUN_COMPLETED_FIXTURE;
}

/**
 * The fixture an operator selected for the next dry dispatch.
 *
 * Set the function secret `ORMA_DRY_RUN_FIXTURE` to `failed` to rehearse the
 * failed terminal shape end to end, or to `no_result` to rehearse the shape a
 * failed result validation reports. CALL-E's own two spellings for that second
 * shape are accepted as well, so an operator who copies a CALL-E status gets
 * the rehearsal they asked for. Any other value selects the completed default,
 * and an unrecognised value is refused rather than guessed, because a rehearsal
 * that silently runs the wrong shape is worse than one that fails.
 */
export function dryRunFixtureName(
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): DryRunFixtureName {
  const value = getEnv("ORMA_DRY_RUN_FIXTURE");
  if (value === undefined || value.trim() === "" || value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "no_result") return "no_result";
  if ((RESULT_VALIDATION_FAILED as readonly string[]).includes(value.trim())) return "no_result";
  throw new Error("ORMA_DRY_RUN_FIXTURE must be completed, failed or no_result");
}

/**
 * The payload a dry run replays through the same ingestion seam a real call
 * uses. A failed fixture carries no turns and no structured result, which is
 * what makes the invalid branch reachable without spending a call.
 *
 * `completedAt` is the rehearsal clock. Ingestion owns `completed_at` and reads
 * it out of this payload, so a rehearsal that dispatched now must also report
 * finishing now. The recording's own timestamp makes a run read as completed
 * before it was dispatched.
 */
export function dryRunSource(
  callRunId: string,
  userId: string,
  fixture: CallTaskFixture,
  completedAt: string,
): TerminalCallSource {
  const attempt = fixture.recipients[0]?.attempts[0];
  return {
    callRunId,
    userId,
    raw: { ...fixture, completed_at: completedAt },
    transcriptTurns: attempt?.transcript_turns ?? [],
    structuredResult: fixture.structured_result,
  };
}

/**
 * The terminal write a dry run applies before it ingests. It deliberately omits
 * `completed_at`, because the ingestion transaction owns that column for a live
 * call too. Only an ingested run reads as final.
 *
 * `terminal_writer` names this write, like the poll and the webhook writes name
 * theirs, so a reader never reads null as nobody having moved the run.
 */
export type DryRunTerminalPatch = {
  state: "completed" | "no_result" | "failed" | "canceled";
  disposition: "answered_extracted" | "answered_no_result" | "not_answered" | "canceled";
  calle_call_id: string;
  calle_confidence: CallTaskFixture["completion_confidence"];
  calle_failure: { failure_code: string; failure_message: string } | null;
  billable: false;
  terminal_writer: "dry_run";
  dispatched_at: string;
};

export type DryRunEvent = {
  callRunId: string;
  kind: "dispatched" | "finalised";
  detail: Record<string, string | number | boolean>;
};

export type DryRunDeps = {
  recordEvent: (event: DryRunEvent) => Promise<void>;
  updateRun: (callRunId: string, patch: DryRunTerminalPatch) => Promise<void>;
  /** The authoritative ingestion seam. Dry mode cannot complete without it. */
  ingest: (source: TerminalCallSource) => Promise<IngestResult>;
  now: () => Date;
};

export type DryRunResult = {
  fixture: CallTaskFixture;
  requestBody: string;
  patch: DryRunTerminalPatch;
  ingested: IngestResult;
};

function parseBoolean(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

/**
 * Global dry mode defaults on. A run can independently force dry mode when an
 * operator has enabled live dispatch globally for a controlled run.
 */
export function isDryRun(
  runDryRun: boolean,
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): boolean {
  return runDryRun || parseBoolean("ORMA_DRY_RUN", getEnv("ORMA_DRY_RUN")) !== false;
}

/**
 * Validates but does not rewrite the request. Keeping this string unchanged is
 * what makes the persisted dry-run body byte-identical to live dispatch.
 */
export function exactRequestBody(requestBody: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestBody);
  } catch {
    throw new Error("dry-run request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("dry-run request body must be a JSON object");
  }
  return requestBody;
}

/**
 * Keeps the leading seven characters of a number and masks the rest, so an
 * operator can still read the shape of a dialled number and never its digits.
 */
function maskPhoneNumber(phone: string): string {
  if (phone.length <= 7) return "X".repeat(phone.length);
  return `${phone.slice(0, 7)}${"X".repeat(phone.length - 7)}`;
}

/**
 * Drops the secret a webhook URL keeps in its final path segment. The scheme,
 * the host and the route stay, so the recorded target is still legible.
 */
function maskWebhookUrl(url: string): string {
  const cut = url.lastIndexOf("/");
  if (cut <= url.indexOf("//") + 1) return "<redacted>";
  return `${url.slice(0, cut + 1)}<redacted>`;
}

/**
 * The body a dry run records. `call_events` is readable by the run's owner, so
 * the recorded copy redacts the two values that must never leave the process,
 * the webhook secret inside `webhook_url` and the callee's full number. Every
 * other byte stays, which keeps the shape legible to an operator.
 */
export function maskedRequestBody(requestBody: string): string {
  const body = JSON.parse(exactRequestBody(requestBody)) as Record<string, unknown>;
  const masked: Record<string, unknown> = { ...body };
  if (typeof body.webhook_url === "string") {
    masked.webhook_url = maskWebhookUrl(body.webhook_url);
  }
  if (Array.isArray(body.recipients)) {
    masked.recipients = body.recipients.map((recipient) => {
      if (typeof recipient !== "object" || recipient === null) return recipient;
      const phones = (recipient as { phones?: unknown }).phones;
      if (!Array.isArray(phones)) return recipient;
      return {
        ...recipient,
        phones: phones.map((phone) => typeof phone === "string" ? maskPhoneNumber(phone) : phone),
      };
    });
  }
  return JSON.stringify(masked);
}

function terminalState(fixture: CallTaskFixture): DryRunTerminalPatch["state"] {
  if (fixture.status === "completed") return "completed";
  if (fixture.status === "canceled") return "canceled";
  if (fixture.status === "failed") return "failed";
  if ((RESULT_VALIDATION_FAILED as readonly string[]).includes(fixture.status)) return "no_result";
  throw new Error("dry-run fixture must be terminal");
}

function dispositionFor(
  state: DryRunTerminalPatch["state"],
  fixture: CallTaskFixture,
): DryRunTerminalPatch["disposition"] {
  if (state === "canceled") return "canceled";
  if (state === "failed") return "not_answered";
  if (state === "no_result") return "answered_no_result";
  return fixture.structured_result === null ? "answered_no_result" : "answered_extracted";
}

export function terminalPatchFromFixture(
  fixture: CallTaskFixture,
  now: Date,
): DryRunTerminalPatch {
  const state = terminalState(fixture);
  const failureCode = fixture.failure_code;
  const failureMessage = fixture.failure_message;
  return {
    state,
    disposition: dispositionFor(state, fixture),
    // Mark this as synthetic so it can never be mistaken for a provider id.
    calle_call_id: `fixture:${fixture.id}`,
    calle_confidence: fixture.completion_confidence,
    calle_failure: failureCode
      ? { failure_code: failureCode, failure_message: failureMessage ?? "" }
      : null,
    billable: false,
    terminal_writer: "dry_run",
    dispatched_at: now.toISOString(),
  };
}

/** The rehearsal shape a terminal patch came from, for the timeline rows. */
function fixtureNameFor(state: DryRunTerminalPatch["state"]): DryRunFixtureName {
  if (state === "failed") return "failed";
  if (state === "no_result") return "no_result";
  return "completed";
}

/**
 * Moves the run to the selected terminal fixture, then replays that fixture
 * through the ingestion seam a live completion uses. This receives no fetch
 * implementation, by design, so it cannot dial.
 *
 * The `dispatched` row records a masked copy of the would-be body rather than
 * the body itself. The exact body carries the webhook secret inside its
 * `webhook_url` and the callee's full number, and `call_events` is readable by
 * the run's owner. The mask keeps the shape an operator reads and redacts only
 * those two values. `requestBody` comes back unchanged, so the dispatcher can
 * still compare the rehearsed bytes against what a live dispatch sends.
 *
 * Ordering: the terminal row is written first, then the dispatch is recorded,
 * then the fixture is ingested, then finalisation is recorded. Recording
 * `dispatched` before the write would leave a timeline entry for a dispatch
 * that never durably happened. The ingestion path sets `completed_at` inside
 * its transaction, so the terminal write alone never reads as a finished run.
 */
export async function executeDryRun(
  callRunId: string,
  userId: string,
  requestBody: string,
  fixture: CallTaskFixture,
  deps: DryRunDeps,
): Promise<DryRunResult> {
  if (!callRunId) throw new Error("dry-run dispatch requires a call run id");
  const exactBody = exactRequestBody(requestBody);
  const now = deps.now();
  const patch = terminalPatchFromFixture(fixture, now);
  const selectedFixture = fixtureNameFor(patch.state);

  await deps.updateRun(callRunId, patch);
  await deps.recordEvent({
    callRunId,
    kind: "dispatched",
    detail: {
      dispatch_mode: "dry_run",
      fixture: selectedFixture,
      outbound_request_made: false,
      request_body: maskedRequestBody(exactBody),
      request_body_masked: true,
    },
  });
  // The rehearsal clock drives both ends of the run. The dispatch stamp comes
  // from the terminal patch, and ingestion reads `completed_at` out of this
  // payload, so a rehearsal can never read as completed before it dispatched.
  const ingested = await deps.ingest(dryRunSource(callRunId, userId, fixture, now.toISOString()));
  await deps.recordEvent({
    callRunId,
    kind: "finalised",
    detail: {
      dispatch_mode: "dry_run",
      fixture: selectedFixture,
      outbound_request_made: false,
      state: patch.state,
      disposition: ingested.disposition,
      item_count: ingested.counts.items,
      mention_count: ingested.counts.mentions,
      failure_reason: patch.calle_failure?.failure_message ?? "",
    },
  });

  return { fixture, requestBody: exactBody, patch, ingested };
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function") {
  const emptySummary: IngestResult = {
    alreadyIngested: false,
    disposition: "not_answered",
    counts: { items: 0, mentions: 0, retirements: 0, commitments: 0 },
    slotChangeRequested: null,
  };

  testFn("the embedded dry fixtures match the committed recordings", async () => {
    const recording = new URL("../../../testdata/calle/", import.meta.url);
    const completed = JSON.parse(
      await Deno.readTextFile(new URL("call-completed.json", recording)),
    );
    const failed = JSON.parse(
      await Deno.readTextFile(new URL("call-failed.json", recording)),
    );
    if (JSON.stringify(completed) !== JSON.stringify(DRY_RUN_COMPLETED_FIXTURE)) {
      throw new Error("the embedded completed fixture drifted from its recording");
    }
    if (JSON.stringify(failed) !== JSON.stringify(DRY_RUN_FAILED_FIXTURE)) {
      throw new Error("the embedded failed fixture drifted from its recording");
    }
  });

  testFn("dry mode defaults on and a run can force it after global opt-in", () => {
    if (!isDryRun(false, () => undefined)) throw new Error("dry mode must default on");
    if (isDryRun(false, () => "false")) throw new Error("explicit global live mode was ignored");
    if (!isDryRun(true, () => "false")) throw new Error("per-run dry mode was ignored");
    try {
      isDryRun(false, () => "yes");
      throw new Error("invalid dry mode value was accepted");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ORMA_DRY_RUN must be true or false") throw error;
    }
  });

  testFn("dry dispatch records a mask of the exact body and makes no outbound request", async () => {
    const body = '{"task":"hello","recipients":[{"phones":["+91XXXXXXXXXX"]}]}';
    const events: DryRunEvent[] = [];
    let patch: DryRunTerminalPatch | undefined;
    const result = await executeDryRun("run-1", "user-1", body, dryRunFixture(), {
      recordEvent: async (event) => { events.push(event); },
      updateRun: async (_runId, nextPatch) => { patch = nextPatch; },
      ingest: async () => emptySummary,
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    });
    if (result.requestBody !== body) throw new Error("dry mode rewrote the live request body");
    if (events[0]?.detail.request_body !== maskedRequestBody(body)) throw new Error("the recorded body is not the mask of the live body");
    if (events[0]?.detail.request_body_masked !== true) throw new Error("the recorded body does not name its own masking");
    if (events.some((event) => event.detail.outbound_request_made !== false)) throw new Error("dry mode reported an outbound request");
    if (patch?.state !== "completed" || patch.billable !== false) throw new Error("recorded completed fixture state was not persisted");
    if (patch.terminal_writer !== "dry_run") throw new Error("the dry terminal write named no writer");
    if (patch.calle_call_id.startsWith("call_")) throw new Error("a synthetic dry run carried a provider call id");
  });

  testFn("a failed run write leaves no dispatch on the timeline", async () => {
    const events: DryRunEvent[] = [];
    await executeDryRun("run-1", "user-1", "{}", dryRunFixture(), {
      recordEvent: async (event) => { events.push(event); },
      updateRun: async () => { throw new Error("call_runs write failed"); },
      ingest: async () => emptySummary,
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    }).then(
      () => { throw new Error("a failed run write was reported as a dispatch"); },
      (error) => {
        if (!(error instanceof Error) || error.message !== "call_runs write failed") throw error;
      },
    );
    if (events.length !== 0) throw new Error(`a failed run write still recorded ${events.map((event) => event.kind).join(",")}`);
  });

  testFn("dry dispatch replays the recording through the ingestion seam", async () => {
    const attempt = DRY_RUN_COMPLETED_FIXTURE.recipients[0].attempts[0];
    const events: DryRunEvent[] = [];
    let source: TerminalCallSource | undefined;
    const result = await executeDryRun("run-1", "user-1", "{}", dryRunFixture(), {
      recordEvent: async (event) => { events.push(event); },
      updateRun: async () => undefined,
      ingest: async (next) => {
        source = next;
        return {
          alreadyIngested: false,
          disposition: "answered_extracted",
          counts: { items: 2, mentions: 5, retirements: 1, commitments: 1 },
          slotChangeRequested: null,
        };
      },
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    });
    if (!source) throw new Error("dry dispatch never reached the ingestion seam");
    if (source.callRunId !== "run-1" || source.userId !== "user-1") throw new Error("dry ingestion was given the wrong run");
    if (source.transcriptTurns.length !== attempt.transcript_turns.length) throw new Error("dry ingestion lost the recorded transcript");
    if (source.structuredResult === null) throw new Error("dry ingestion lost the recorded structured result");
    const finalised = events.find((event) => event.kind === "finalised");
    if (finalised?.detail.item_count !== 2 || finalised.detail.mention_count !== 5) throw new Error("the finalised row did not carry the ingested counts");
    if (result.ingested.counts.items !== 2) throw new Error("dry dispatch discarded the ingestion summary");
  });

  testFn("a failed fixture replays an empty transcript and no result", () => {
    const source = dryRunSource("run-1", "user-1", dryRunFixture("failed"), "2026-09-13T00:00:00.000Z");
    if (source.transcriptTurns.length !== 0) throw new Error("the failed fixture must replay no turns");
    if (source.structuredResult !== null) throw new Error("the failed fixture must reach the no-result path");
  });

  testFn("the recorded dry body redacts the secret and the number, and nothing else", () => {
    const live = JSON.stringify({
      task: "call the dentist",
      recipients: [{ phones: ["+919999999991"], status: "queued" }],
      result_schema: { type: "object" },
      webhook_url: "https://orma-api.nryn.dev/functions/v1/calle-webhook/deployment-secret",
      metadata: { call_run_id: "run-1" },
    });
    const masked = maskedRequestBody(live);
    const parsed = JSON.parse(masked) as {
      recipients: Array<{ phones: string[]; status: string }>;
      webhook_url: string;
    };
    if (masked.includes("deployment-secret")) throw new Error("the recorded body still carries the webhook secret");
    if (masked.includes("+919999999991")) throw new Error("the recorded body still carries the callee's number");
    if (parsed.webhook_url !== "https://orma-api.nryn.dev/functions/v1/calle-webhook/<redacted>") {
      throw new Error(`the recorded webhook url is not the redacted route, saw ${parsed.webhook_url}`);
    }
    if (parsed.recipients[0].phones[0] !== "+919999XXXXXX") {
      throw new Error(`the recorded number is not masked, saw ${parsed.recipients[0].phones[0]}`);
    }
    if (parsed.recipients[0].status !== "queued") throw new Error("the mask dropped a field beside the number");
    const restored = masked
      .replace("+919999XXXXXX", "+919999999991")
      .replace("/<redacted>", "/deployment-secret");
    if (restored !== live) throw new Error("the mask changed bytes outside the number and the secret");
  });

  testFn("a dry run takes both stamps from the rehearsal clock", async () => {
    const rehearsal = new Date("2026-09-13T09:50:57.284Z");
    let patch: DryRunTerminalPatch | undefined;
    let source: TerminalCallSource | undefined;
    await executeDryRun("run-1", "user-1", "{}", dryRunFixture(), {
      recordEvent: async () => undefined,
      updateRun: async (_runId, nextPatch) => { patch = nextPatch; },
      ingest: async (next) => { source = next; return emptySummary; },
      now: () => rehearsal,
    });
    if (patch?.dispatched_at !== rehearsal.toISOString()) {
      throw new Error(`the dispatch stamp is not the rehearsal clock, saw ${patch?.dispatched_at}`);
    }
    const raw = source?.raw as { completed_at?: string } | undefined;
    if (raw?.completed_at !== rehearsal.toISOString()) {
      throw new Error(`ingestion was handed the recording's clock, saw ${raw?.completed_at}`);
    }
  });

  testFn("dry dispatch rejects invalid bodies before writing anything", async () => {
    let wrote = false;
    await executeDryRun("run-1", "user-1", "not-json", dryRunFixture(), {
      recordEvent: async () => { wrote = true; },
      updateRun: async () => { wrote = true; },
      ingest: async () => { wrote = true; return emptySummary; },
      now: () => new Date(),
    }).then(() => { throw new Error("invalid body was accepted"); }, (error) => {
      if (!(error instanceof Error) || error.message !== "dry-run request body must be valid JSON") throw error;
    });
    if (wrote) throw new Error("invalid body wrote a partial dry run");
  });

  testFn("dry dispatch can synthesize the recorded failed terminal fixture", async () => {
    const events: DryRunEvent[] = [];
    let patch: DryRunTerminalPatch | undefined;
    await executeDryRun("run-1", "user-1", "{}", dryRunFixture("failed"), {
      recordEvent: async (event) => { events.push(event); },
      updateRun: async (_runId, nextPatch) => { patch = nextPatch; },
      ingest: async () => emptySummary,
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    });
    if (patch?.state !== "failed" || patch.disposition !== "not_answered") {
      throw new Error("failed fixture did not produce a failed, non-billable run");
    }
    const finalised = events.find((event) => event.kind === "finalised");
    if (finalised?.detail.failure_reason !== DRY_RUN_FAILED_FIXTURE.failure_message) {
      throw new Error("failed dry-run timeline lost the recorded terminal reason");
    }
  });

  testFn("the rehearsal can reach the no_result terminal shape", () => {
    // The derived shape differs from the completed recording in exactly the two
    // fields that make it a validation failure.
    const rehearsal = dryRunFixture("no_result");
    const changed = Object.entries(DRY_RUN_COMPLETED_FIXTURE)
      .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(
        (rehearsal as unknown as Record<string, unknown>)[key],
      ))
      .map(([key]) => key)
      .sort();
    if (changed.join(",") !== "status,structured_result") {
      throw new Error(`the no_result rehearsal changed ${changed.join(",") || "nothing"}`);
    }
    if (!(RESULT_VALIDATION_FAILED as readonly string[]).includes(rehearsal.status)) {
      throw new Error(`the rehearsal carries the status ${rehearsal.status}`);
    }
    const patch = terminalPatchFromFixture(rehearsal, new Date("2026-09-13T00:00:00.000Z"));
    if (patch.state !== "no_result" || patch.disposition !== "answered_no_result") {
      throw new Error(`the rehearsal landed ${patch.state} ${patch.disposition}`);
    }
    if (patch.billable !== false || !patch.calle_call_id.startsWith("fixture:")) {
      throw new Error("a rehearsal's synthetic call id must never bill");
    }
    const source = dryRunSource("run-1", "user-1", rehearsal, "2026-09-13T00:00:00.000Z");
    if (source.structuredResult !== null) throw new Error("the rehearsal still carries an extract");
    if ((source.raw as { status?: string }).status !== rehearsal.status) {
      throw new Error("ingestion was handed a different status than the rehearsal carries");
    }
  });

  testFn("a rehearsal reaches no_result end to end with its disposition", async () => {
    const events: DryRunEvent[] = [];
    let patch: DryRunTerminalPatch | undefined;
    let source: TerminalCallSource | undefined;
    await executeDryRun("run-1", "user-1", "{}", dryRunFixture("no_result"), {
      recordEvent: async (event) => { events.push(event); },
      updateRun: async (_runId, nextPatch) => { patch = nextPatch; },
      ingest: async (next) => {
        source = next;
        return {
          alreadyIngested: false,
          disposition: "answered_no_result",
          counts: { items: 0, mentions: 0, retirements: 0, commitments: 0 },
          slotChangeRequested: null,
        };
      },
      now: () => new Date("2026-09-13T00:00:00.000Z"),
    });
    if (patch?.state !== "no_result" || patch.disposition !== "answered_no_result") {
      throw new Error(`the terminal patch read ${JSON.stringify(patch)}`);
    }
    if (!source) throw new Error("the rehearsal never reached the ingestion seam");
    const dispatched = events.find((event) => event.kind === "dispatched");
    const finalised = events.find((event) => event.kind === "finalised");
    if (dispatched?.detail.fixture !== "no_result" || finalised?.detail.fixture !== "no_result") {
      throw new Error(`the timeline named the wrong rehearsal: ${JSON.stringify(events.map((event) => event.detail.fixture))}`);
    }
    if (finalised?.detail.state !== "no_result" || finalised.detail.disposition !== "answered_no_result") {
      throw new Error(`the finalised row read ${JSON.stringify(finalised.detail)}`);
    }
  });

  testFn("an operator selects a dry fixture by environment", () => {
    if (dryRunFixtureName(() => undefined) !== "completed") {
      throw new Error("the completed fixture must be the default");
    }
    if (dryRunFixtureName((name) => (name === "ORMA_DRY_RUN_FIXTURE" ? "" : "true")) !== "completed") {
      throw new Error("an empty fixture setting must select the default");
    }
    if (dryRunFixture(dryRunFixtureName(() => "failed")).status !== "failed") {
      throw new Error("the selected failed fixture did not reach the dispatcher");
    }
    // Both of CALL-E's spellings, and the state name, select the shape a failed
    // result validation reports.
    for (const spelling of ["no_result", ...RESULT_VALIDATION_FAILED]) {
      if (dryRunFixtureName(() => spelling) !== "no_result") {
        throw new Error(`the rehearsal spelling ${spelling} did not select no_result`);
      }
      if (dryRunFixture(dryRunFixtureName(() => spelling)).structured_result !== null) {
        throw new Error(`the rehearsal spelling ${spelling} selected a shape with an extract`);
      }
    }
    try {
      dryRunFixtureName(() => "no-answer");
      throw new Error("an unrecognised fixture name was accepted");
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ORMA_DRY_RUN_FIXTURE must be completed, failed or no_result") throw error;
    }
  });
}
