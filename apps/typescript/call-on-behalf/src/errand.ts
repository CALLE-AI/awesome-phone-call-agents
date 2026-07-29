/**
 * The errand: one call, one report.
 *
 * Two gates run around the call. Before it, the generated script is scanned for
 * any personal detail the person did not authorize and a finding refuses the
 * call rather than warning about it. After it, everything the caller actually
 * said is scanned the same way, so a detail the caller volunteered on its own is
 * reported to the person it belongs to.
 */

import { blocking, spokenItems, unauthorizedFindings, withoutKnownNumbers } from "./disclosure.js";
import { CalleCallError, CalleWaitTimeout, type CallePort } from "./calle.js";
import { readTranscript } from "./read.js";
import {
  buildResultSchema,
  buildTask,
  idempotencyKey,
  metadata,
  spokenLocal,
  withinWindows,
} from "./script.js";
import type {
  CallSnapshot,
  CommitmentState,
  DisclosureFinding,
  ErrandOutcome,
  ErrandReport,
  ErrandRequest,
  QuestionAnswer,
} from "./types.js";

export class PreflightError extends Error {
  readonly findings: DisclosureFinding[];

  constructor(findings: DisclosureFinding[]) {
    super(
      `The call script would say ${findings.length} detail(s) nobody authorized: ${findings
        .map((finding) => `${finding.kind} (${finding.masked}) in ${finding.where}`)
        .join(", ")}. No call was placed.`,
    );
    this.findings = findings;
  }
}

export function maskPhone(phone: string): string {
  if (phone.length <= 5) {
    return "***";
  }
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(phone.length - 5, 1))}${phone.slice(-2)}`;
}

/** Everything in the script that looks personal and is not in the budget. */
export function preflight(request: ErrandRequest): DisclosureFinding[] {
  const knownNumbers = [request.callee.phone, ...request.disclosure.map((item) => item.value)];
  const script = withoutKnownNumbers(buildTask(request), knownNumbers);
  return unauthorizedFindings(script, request.disclosure, "call script");
}

function readString(structured: Record<string, unknown> | null, key: string): string {
  const value = structured?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function failureOutcome(failureCode: string | null): ErrandOutcome {
  const code = (failureCode ?? "").toLowerCase();
  if (code.includes("voicemail") || code.includes("machine")) {
    return "voicemail";
  }
  if (code.includes("answer") || code.includes("busy") || code.includes("unreachable")) {
    return "not_reached";
  }
  return "call_failed";
}

function nextStep(
  outcome: ErrandOutcome,
  commitment: CommitmentState,
  request: ErrandRequest,
  offered: string,
): string {
  if (outcome === "callee_declined_automated") {
    return `${request.callee.name} will not deal with an automated caller. Nothing was arranged. Call them yourself, ask somebody to call for you or use a relay service if you have one.`;
  }
  if (outcome === "voicemail") {
    return "The line went to a machine, so nothing was asked. Try again at a different time of day.";
  }
  if (outcome === "not_reached" || outcome === "call_failed" || outcome === "api_error") {
    return "The call did not connect to a person. Nothing was said on your behalf and nothing was arranged.";
  }
  if (commitment === "outside_authorized_window") {
    return `Something was agreed for ${offered}, which is outside the windows you authorized. Check it and cancel it if it does not work, because this app should not have accepted it.`;
  }
  if (commitment === "proposal_only") {
    return `They offered ${offered || "another time"} and nothing was agreed. Say the word if you want it and the errand can run again with that window authorized.`;
  }
  if (commitment === "committed") {
    return "That is arranged. The confirmation, if they gave one, is in the report above.";
  }
  if (outcome === "goal_met") {
    return "Everything you asked was answered. Nothing was agreed, because this errand did not ask for anything to be agreed.";
  }
  return "Some of it came back. The unanswered questions are marked above and nothing was agreed.";
}

export interface RunOptions {
  request: ErrandRequest;
  port: CallePort;
  pollIntervalMs?: number;
  onProgress?: (line: string) => void;
}

export async function runErrand(options: RunOptions): Promise<ErrandReport> {
  const { request, port } = options;
  const progress = options.onProgress ?? (() => {});

  const findings = blocking(preflight(request));
  if (findings.length > 0) {
    throw new PreflightError(findings);
  }

  const task = buildTask(request);
  let call: CallSnapshot | null = null;
  let apiErrorCode: string | null = null;
  progress(`Calling ${request.callee.name} on ${maskPhone(request.callee.phone)}.`);
  try {
    const created = await port.createCall(
      {
        task,
        recipients: [
          {
            phones: [request.callee.phone],
            locale: request.policy.language,
            ...(request.callee.region === undefined ? {} : { region: request.callee.region }),
          },
        ],
        resultSchema: buildResultSchema(request),
        metadata: metadata(request),
      },
      idempotencyKey(request),
    );
    progress(`Call ${created.id} created.`);
    try {
      call = await port.waitForResult(created.id, {
        timeoutMs: request.policy.perCallTimeoutSeconds * 1000,
        intervalMs: options.pollIntervalMs ?? 2000,
      });
    } catch (error) {
      if (error instanceof CalleWaitTimeout) {
        progress("The call ran past the timeout, reading its last state.");
        call = await port.getCall(created.id);
      } else {
        throw error;
      }
    }
  } catch (error) {
    apiErrorCode = error instanceof CalleCallError ? error.code : "sdk_error";
    progress(`CALL-E returned ${apiErrorCode}.`);
  }

  const base = {
    errand_id: request.errandId,
    on_behalf_of: request.onBehalfOf.name,
    callee_name: request.callee.name,
    callee_phone_masked: maskPhone(request.callee.phone),
    authorized_but_unused: request.disclosure.map((item) => item.label),
  };

  if (call === null) {
    return {
      ...base,
      outcome: "api_error",
      commitment: "none_sought",
      committed_datetime: null,
      confirmation_code: "",
      answers: request.questions.map((question) => ({
        id: question.id,
        text: question.text,
        answered: false,
        answer: "",
        quote: "",
      })),
      disclosed: [],
      leaks: [],
      reached_person: false,
      callee_notes: apiErrorCode ?? "the call was not created",
      next_step: nextStep("api_error", "none_sought", request, ""),
      call_id: null,
      provider_call_id: null,
      call_status: "api_error",
      started_at: null,
      completed_at: null,
      transcript: [],
    };
  }

  const recipient = call.recipients[0] ?? null;
  const attempt = recipient?.attempts.at(-1) ?? null;
  const turns = attempt?.transcriptTurns ?? [];
  const reading = readTranscript(turns);
  const structured = call.structuredResult ?? recipient?.structuredResult ?? null;
  const confidence = call.completionConfidence ?? null;
  const lowConfidence = confidence !== null && confidence.score < request.policy.minConfidence;

  const answers: QuestionAnswer[] = request.questions.map((question) => {
    const answer = readString(structured, `answer_${question.id}`);
    return {
      id: question.id,
      text: question.text,
      answered: answer.length > 0 && reading.reachedPerson,
      answer,
      quote: "",
    };
  });

  const madeRaw = readString(structured, "commitment_made");
  const offered = readString(structured, "offered_datetime");
  const offeredSpoken = /^\d{4}-\d{2}-\d{2}T/.test(offered) ? spokenLocal(offered) : offered;
  let commitment: CommitmentState = "none_sought";
  if (request.goal.commitment !== "none") {
    if (madeRaw === "accepted") {
      commitment =
        request.goal.commitment === "confirm_existing"
          ? "committed"
          : withinWindows(offered, request.authorizedWindows)
            ? "committed"
            : "outside_authorized_window";
    } else if (madeRaw === "other_time_offered") {
      commitment = "proposal_only";
    } else if (madeRaw === "declined_by_callee") {
      commitment = "declined_by_callee";
    }
  }

  const answered = answers.filter((answer) => answer.answered).length;
  let outcome: ErrandOutcome;
  if (call.status === "failed" || call.status === "canceled") {
    outcome = failureOutcome(attempt?.failureCode ?? call.failureCode);
  } else if (reading.declinedAutomated) {
    outcome = "callee_declined_automated";
  } else if (reading.machineAnswered) {
    outcome = "voicemail";
  } else if (!reading.reachedPerson) {
    outcome = "not_reached";
  } else {
    const commitmentSettled =
      request.goal.commitment === "none" || commitment === "committed" || commitment === "declined_by_callee";
    outcome =
      answered === answers.length && commitmentSettled
        ? "goal_met"
        : answered > 0 || commitment !== "none_sought"
          ? "partially_met"
          : "not_met";
    if (lowConfidence && outcome === "goal_met") {
      outcome = "partially_met";
    }
  }

  const disclosed = spokenItems(reading.botText, request.disclosure).map((item) => item.label);
  const leaks = unauthorizedFindings(
    withoutKnownNumbers(reading.botText, [request.callee.phone, ...request.disclosure.map((item) => item.value)]),
    request.disclosure,
    "what the caller said",
  );
  const notes = [readString(structured, "notes")];
  if (lowConfidence) {
    notes.push(`CALL-E scored its own completion low (${String(confidence?.score)}), so treat the answers with care.`);
  }
  if (reading.declineQuote.length > 0) {
    notes.push(`They said: "${reading.declineQuote}"`);
  }

  return {
    ...base,
    outcome,
    commitment,
    committed_datetime: commitment === "committed" && offered.length > 0 ? offered : null,
    confirmation_code: readString(structured, "confirmation_code"),
    answers,
    disclosed,
    authorized_but_unused: request.disclosure
      .filter((item) => !disclosed.includes(item.label))
      .map((item) => item.label),
    leaks,
    reached_person: reading.reachedPerson,
    callee_notes: notes.filter((note) => note.length > 0).join(" "),
    next_step: nextStep(outcome, commitment, request, offeredSpoken),
    call_id: call.id,
    provider_call_id: attempt?.providerCallId ?? null,
    call_status: call.status,
    started_at: attempt?.startedAt ?? call.createdAt,
    completed_at: attempt?.completedAt ?? call.completedAt,
    transcript: turns,
  };
}
