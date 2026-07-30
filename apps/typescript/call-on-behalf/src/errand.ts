/**
 * The errand: one call, one report.
 *
 * Two gates run around the call. Before it, the generated script is scanned for
 * any personal detail the person did not authorize and a finding refuses the
 * call rather than warning about it. After it, everything the caller actually
 * said is scanned the same way, so a detail the caller volunteered on its own is
 * reported to the person it belongs to.
 *
 * Nothing here reports more than it knows. An answer or an agreement is only
 * reported when the transcript supports it. A call this app could not read comes
 * back as an unknown outcome rather than as a failure, because "nothing was said"
 * is a claim of its own. Only a call CALL-E has finished with is read at all: a
 * queued, ringing or running call is an unknown outcome too, because its transcript
 * is still being written.
 */

import { blocking, sensitiveTopicFindings, spokenItems, unauthorizedFindings, withoutKnownNumbers } from "./disclosure.js";
import { CalleCallError, CalleWaitTimeout, isTerminalCallStatus, type CallePort } from "./calle.js";
import { agreementEvidence, readTranscript, supportingTurn } from "./read.js";
import {
  buildCallInput,
  buildTask,
  idempotencyKey,
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

/**
 * Everything in the outgoing text that looks personal and is not in the budget,
 * plus any clinical, legal or financial wording, which is reported and never
 * blocked because only the person can say whether it belongs on the call.
 */
export function preflight(request: ErrandRequest): DisclosureFinding[] {
  const knownNumbers = [request.callee.phone, ...request.disclosure.map((item) => item.value)];
  const script = withoutKnownNumbers(buildTask(request), knownNumbers);
  return [
    ...unauthorizedFindings(script, request.disclosure, "call script"),
    ...sensitiveTopicFindings(request.goal.summary, "goal.summary"),
    ...request.questions.flatMap((question, index) =>
      sensitiveTopicFindings(question.text, `questions[${index}].text`),
    ),
  ];
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

/** A call this app could not read at all. Nobody knows whether it was even made. */
const UNREAD_NEXT_STEP =
  "CALL-E took the errand and this app could not read what happened, so nobody knows yet whether the call was made or what was said. Treat nothing as arranged. Running this same errand file again reads that same call back instead of ringing anybody, because the key is unchanged. Edit the file first and it becomes a different call, so do not edit it.";

/** A call CALL-E has not finished with. It exists and it has no result yet. */
const UNFINISHED_NEXT_STEP =
  "CALL-E still had this call open when this app stopped waiting, so what was said and whether anything was agreed is not known yet. Treat nothing as arranged. Running this same errand file again reads that same call back instead of ringing anybody, because the key is unchanged. Edit the file first and it becomes a different call, so do not edit it.";

function nextStep(
  outcome: ErrandOutcome,
  commitment: CommitmentState,
  request: ErrandRequest,
  offered: string,
  stillOpen = false,
): string {
  if (outcome === "outcome_unknown") {
    return stillOpen ? UNFINISHED_NEXT_STEP : UNREAD_NEXT_STEP;
  }
  if (outcome === "api_error") {
    return "CALL-E refused to create the call, so no call was placed and nothing was said on your behalf. The reason is in the notes above.";
  }
  if (outcome === "callee_declined_automated") {
    return `${request.callee.name} will not deal with an automated caller. Nothing was arranged. Call them yourself, ask somebody to call for you or use a relay service if you have one.`;
  }
  if (outcome === "voicemail") {
    return "The line went to a machine, so nothing was asked. Try again at a different time of day.";
  }
  if (outcome === "not_reached" || outcome === "call_failed") {
    return "The call did not connect to a person. Nothing was said on your behalf and nothing was arranged.";
  }
  if (commitment === "unconfirmed") {
    return "Something was reported as agreed and the transcript does not show anybody agreeing to it, so treat nothing as booked. Read the transcript below, then call to check if you need it.";
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

function asCallError(error: unknown): CalleCallError {
  return error instanceof CalleCallError ? error : new CalleCallError("sdk_error", String(error));
}

export async function runErrand(options: RunOptions): Promise<ErrandReport> {
  const { request, port } = options;
  const progress = options.onProgress ?? (() => {});

  const findings = blocking(preflight(request));
  if (findings.length > 0) {
    throw new PreflightError(findings);
  }

  const input = buildCallInput(request);
  const key = idempotencyKey(request);
  let call: CallSnapshot | null = null;
  let callId: string | null = null;
  /** Set when CALL-E refused outright, so no call exists. */
  let refusal: CalleCallError | null = null;
  /** Set when the call may exist and this app cannot say what it did. */
  let unknown: string | null = null;

  progress(`Calling ${request.callee.name} on ${maskPhone(request.callee.phone)}.`);
  try {
    const created = await port.createCall(input, key);
    callId = created.id;
    progress(`Call ${created.id} created.`);
  } catch (error) {
    const problem = asCallError(error);
    progress(`CALL-E returned ${problem.code} on create.`);
    if (problem.ambiguous) {
      // The request may have reached CALL-E, so ask for the same idempotency key
      // back. That returns the call if it exists and never rings a second time.
      progress("That leaves the call unknown, so reconciling under the same key.");
      try {
        const reconciled = await port.createCall(input, key);
        callId = reconciled.id;
        progress(`Reconciled to call ${reconciled.id}.`);
      } catch (secondError) {
        const second = asCallError(secondError);
        if (second.ambiguous) {
          unknown = `the call could not be reconciled (${problem.code}, then ${second.code})`;
        } else {
          refusal = second;
        }
      }
    } else {
      refusal = problem;
    }
  }

  if (callId !== null) {
    try {
      call = await port.waitForResult(callId, {
        timeoutMs: request.policy.perCallTimeoutSeconds * 1000,
        intervalMs: options.pollIntervalMs ?? 2000,
      });
    } catch (error) {
      progress(
        error instanceof CalleWaitTimeout
          ? "The call ran past the timeout, reading its last state."
          : `CALL-E returned ${asCallError(error).code} while waiting, reading the call directly.`,
      );
      try {
        call = await port.getCall(callId);
      } catch (readError) {
        unknown = `the call was created and its state could not be read (${asCallError(readError).code})`;
      }
    }
  }

  const base = {
    errand_id: request.errandId,
    on_behalf_of: request.onBehalfOf.name,
    callee_name: request.callee.name,
    callee_phone_masked: maskPhone(request.callee.phone),
    authorized_but_unused: request.disclosure.map((item) => item.label),
  };

  /** What is known about a call that exists and has no result, for the report. */
  let stillOpen: { providerCallId: string | null; startedAt: string | null } | null = null;

  if (call !== null && !isTerminalCallStatus(call.status)) {
    // A call CALL-E has not finished with is not a result. Its transcript is still
    // being written and its extraction is whatever the model has so far, so reading
    // one as an outcome is how a call still ringing gets reported as an errand done.
    const open = call.recipients[0]?.attempts.at(-1) ?? null;
    progress(`CALL-E still has call ${call.id} as ${call.status || "no status"}, so there is no result to read.`);
    unknown = `the call was created and CALL-E still had it as ${call.status || "no status"}, so it has no result yet`;
    stillOpen = { providerCallId: open?.providerCallId ?? null, startedAt: open?.startedAt ?? call.createdAt };
    callId = call.id;
    call = null;
  }

  if (call === null) {
    if (unknown === null && refusal === null) {
      unknown = "the call was created and no result came back";
    }
    const outcome: ErrandOutcome = unknown === null ? "api_error" : "outcome_unknown";
    return {
      ...base,
      outcome,
      // An unknown call may have agreed to something, so it is not "none sought".
      commitment: outcome === "outcome_unknown" && request.goal.commitment !== "none" ? "unconfirmed" : "none_sought",
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
      // For a refusal nothing was said, so everything was unused. For an unknown
      // call neither list is known, so it claims neither.
      authorized_but_unused: outcome === "outcome_unknown" ? [] : request.disclosure.map((item) => item.label),
      leaks: [],
      reached_person: false,
      callee_notes: unknown ?? refusal?.code ?? "the call was not created",
      next_step: nextStep(outcome, "none_sought", request, "", stillOpen !== null),
      call_id: callId,
      provider_call_id: stillOpen?.providerCallId ?? null,
      call_status: outcome === "outcome_unknown" ? "unknown" : "api_error",
      started_at: stillOpen?.startedAt ?? null,
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

  // The extraction proposes an answer. The transcript is what decides whether the
  // report may state it, so an answer nobody can be quoted saying is not answered.
  const answers: QuestionAnswer[] = request.questions.map((question) => {
    const claimed = readString(structured, `answer_${question.id}`);
    const quote = reading.reachedPerson ? supportingTurn(question, claimed, turns) : "";
    const answered = quote.length > 0;
    return {
      id: question.id,
      text: question.text,
      answered,
      answer: answered ? claimed : "",
      quote,
    };
  });
  const unsupported = request.questions.filter(
    (question, index) =>
      readString(structured, `answer_${question.id}`).length > 0 && !answers[index]!.answered,
  ).length;

  const madeRaw = readString(structured, "commitment_made");
  const offered = readString(structured, "offered_datetime");
  const offeredSpoken = /^\d{4}-\d{2}-\d{2}T/.test(offered) ? spokenLocal(offered) : offered;
  let commitment: CommitmentState = "none_sought";
  let agreedQuote = "";
  /** Booking language the transcript carries that is not evidence for the claim. */
  let unrelatedQuote = "";
  if (request.goal.commitment !== "none") {
    if (madeRaw === "accepted") {
      const agreement = agreementEvidence(turns, request.goal.commitment, offered);
      agreedQuote = agreement.quote;
      if (agreedQuote.length === 0) {
        // An agreement about a time nobody said is not an agreement this app can
        // report, so it does not become committed and it does not become an
        // unauthorized booking either. Both of those print a time off the
        // extraction alone. It reads unconfirmed and the note says which it was.
        commitment = "unconfirmed";
        unrelatedQuote = agreement.otherQuote;
      } else {
        commitment =
          request.goal.commitment === "confirm_existing"
            ? "committed"
            : withinWindows(offered, request.authorizedWindows)
              ? "committed"
              : "outside_authorized_window";
      }
    } else if (madeRaw === "other_time_offered") {
      commitment = "proposal_only";
    } else if (madeRaw === "declined_by_callee") {
      commitment = "declined_by_callee";
    }
  }

  const answered = answers.filter((answer) => answer.answered).length;
  let outcome: ErrandOutcome;
  if (call.status !== "completed") {
    // Terminal and not completed, so the call ended before the conversation did.
    // The failure code says why when there is one and the status says it otherwise.
    outcome = failureOutcome(attempt?.failureCode ?? call.failureCode ?? call.status);
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
  if (unsupported > 0) {
    notes.push(
      `CALL-E reported ${unsupported} answer(s) the transcript does not support, so they are marked not answered.`,
    );
  }
  if (agreedQuote.length > 0) {
    notes.push(`They agreed with: "${agreedQuote}"`);
  }
  if (commitment === "unconfirmed") {
    notes.push(
      unrelatedQuote.length > 0
        ? `CALL-E reported an agreement for ${offeredSpoken || "a time"} and no turn in the transcript agrees to that. They did say: "${unrelatedQuote}"`
        : "CALL-E reported an agreement and no turn in the transcript shows anybody agreeing.",
    );
  }
  if (reading.declineQuote.length > 0) {
    notes.push(`They said: "${reading.declineQuote}"`);
  }

  return {
    ...base,
    outcome,
    commitment,
    committed_datetime: commitment === "committed" && offered.length > 0 ? offered : null,
    // A reference number belongs to an agreement, so it goes with the evidence for one.
    confirmation_code: agreedQuote.length > 0 ? readString(structured, "confirmation_code") : "",
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
