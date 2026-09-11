import type {
  AccountEvent,
  CallIntent,
  DecisionOption,
  DecisionResult,
} from "../schemas.js";
import { DecisionResultSchema } from "../schemas.js";
import type { RingMode } from "../policy/shouldRing.js";
import { checkIdentityReadback } from "../calle/stageCode.js";
import {
  failureCodesSuggestNoAnswer,
  isLowCompletionConfidence,
  summaryLooksLikeVoicemailOrNoAnswer,
  type CompletionConfidence,
} from "./sdkOutcome.js";

export interface ToDecisionInput {
  event: AccountEvent;
  intent: CallIntent;
  options: DecisionOption[];
  mode: RingMode;
  callRunId?: string | null;
  structured?: Record<string, unknown> | null;
  holdReason?: string | null;
  /** CALL-E call/recipient summary when structured result is missing */
  callSummary?: string | null;
  taskCompleted?: boolean | null;
  /** Prefer over summary heuristics — call + attempt failureCode values */
  failureCodes?: string[];
  failureMessages?: string[];
  completionConfidence?: CompletionConfidence;
  /** Evidence snippets from CALL-E (logged in notes when useful) */
  evidence?: string[];
  /** Transcript turns for fallback option parsing + identity read-back */
  transcriptTexts?: string[];
  /** Expected spoken stage code (identity read-back). */
  expectedStageCode?: string | null;
  /** Dress rehearsal may simulate a choice (default option 1). */
  simulatedOptionId?: "1" | "2" | "3";
  /** Provider failure audit (never a human decision). */
  failure?: { category: string; summary: string } | null;
}

const WORD_TO_OPTION: Record<string, "1" | "2" | "3"> = {
  "1": "1",
  one: "1",
  first: "1",
  "2": "2",
  two: "2",
  second: "2",
  "3": "3",
  three: "3",
  third: "3",
};

/** True when a bare digit/word is clearly not a line reading (e.g. "3 other fires"). */
function isSpuriousDigitContext(text: string, index: number, matched: string): boolean {
  const token = matched.trim();
  const after = text.slice(index + matched.length, index + matched.length + 32).toLowerCase();
  if (
    /^\s*(other|others|more|fires|tickets|accounts|people|things|hours|minutes|days|weeks|calls|options?)\b/.test(
      after,
    )
  ) {
    return true;
  }
  const before = text.slice(Math.max(0, index - 24), index).toLowerCase();
  if (
    /\b(have|had|got|with|and|plus|another)\s*$/.test(before) &&
    (/^\d$/.test(token) || /^(one|two|three)$/i.test(token))
  ) {
    return true;
  }
  return false;
}

/**
 * Gated transcript → option. Prefer explicit "option N" / word forms.
 * Rejects embedded counts like "3 other fires". Takes the last *confident* hit.
 */
export function optionFromTranscript(
  texts: string[] | undefined,
  options: DecisionOption[],
): DecisionOption | null {
  if (!texts?.length) return null;
  const joined = texts.join(" \n ");

  const patterns: RegExp[] = [
    /\boption\s*([123])\b/gi,
    /\b(?:uh+[,.]?\s*)?(one|two|three)\b/gi,
    /\b([123])\s*(?:please|thanks|thank you)?\b/gi,
    /\b(?:the\s+)?(first|second|third)(?:\s+one)?\b/gi,
  ];

  let lastId: "1" | "2" | "3" | null = null;
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(joined)) !== null) {
      const raw = m[1].toLowerCase();
      const id = WORD_TO_OPTION[raw];
      if (!id) continue;
      const captureOffset = Math.max(0, m[0].toLowerCase().lastIndexOf(raw));
      const tokenIndex = m.index + captureOffset;
      if (isSpuriousDigitContext(joined, tokenIndex, raw)) continue;
      if (/^(one|two|three)$/.test(raw)) {
        const before = joined.slice(Math.max(0, tokenIndex - 14), tokenIndex).toLowerCase();
        if (/\b(first|second|third)\s+$/.test(before)) continue;
      }
      lastId = id;
    }
  }

  if (!lastId) return null;
  return options.find((o) => o.option_id === lastId) ?? null;
}

type StructuredParse =
  | { kind: "ok"; option: DecisionOption }
  | { kind: "contradiction" }
  | { kind: "none" };

/**
 * Prefer option_id. Contradiction only when another field resolves to a
 * *different* closed-set option. CALL-E often paraphrases `decision`
 * (e.g. "takeover" vs "take_over_chat") — that is not a cross-option conflict.
 * Do not trust decision/label alone when option_id is missing.
 */
export function parseStructuredOption(
  options: DecisionOption[],
  structured: Record<string, unknown> | null | undefined,
): StructuredParse {
  if (!structured || Object.keys(structured).length === 0) return { kind: "none" };

  const optionId = String(structured.option_id ?? "").trim();
  const byId = options.find((o) => o.option_id === optionId);
  if (!byId) {
    // No usable option_id — do not silently trust decision/label alone for live
    return { kind: "none" };
  }

  const decisionRaw =
    structured.decision !== undefined && structured.decision !== null
      ? String(structured.decision).trim()
      : "";
  const labelRaw =
    structured.decision_label !== undefined && structured.decision_label !== null
      ? String(structured.decision_label).trim()
      : "";

  const byDecision = decisionRaw
    ? options.find((o) => o.decision === decisionRaw)
    : undefined;
  const byLabel = labelRaw
    ? options.find((o) => o.decision_label.toLowerCase() === labelRaw.toLowerCase())
    : undefined;

  if (byDecision && byDecision.option_id !== byId.option_id) {
    return { kind: "contradiction" };
  }
  if (byLabel && byLabel.option_id !== byId.option_id) {
    return { kind: "contradiction" };
  }
  return { kind: "ok", option: byId };
}

function unclearResult(
  input: ToDecisionInput,
  label: string,
  notes: string | null,
): DecisionResult {
  const { event, mode } = input;
  return DecisionResultSchema.parse({
    trigger_id: event.trigger_id,
    account_id: event.account.id,
    account_name: event.account.name,
    cs_owner_id: event.cs_owner.id,
    call_run_id: input.callRunId ?? null,
    decision: "unclear",
    decision_label: label,
    option_id: "unknown",
    notes_short: notes,
    follow_up_at: null,
    completed_at: new Date().toISOString(),
    mode,
    hold_reason: null,
  });
}

function noAnswerResult(input: ToDecisionInput, notes: string | null): DecisionResult {
  const { event, mode } = input;
  return DecisionResultSchema.parse({
    trigger_id: event.trigger_id,
    account_id: event.account.id,
    account_name: event.account.name,
    cs_owner_id: event.cs_owner.id,
    call_run_id: input.callRunId ?? null,
    decision: "no_answer",
    decision_label: "No line reading — voicemail / no answer",
    option_id: "unknown",
    notes_short: notes,
    follow_up_at: null,
    completed_at: new Date().toISOString(),
    mode,
    hold_reason: null,
  });
}

function isNoAnswer(input: ToDecisionInput): boolean {
  if (failureCodesSuggestNoAnswer(...(input.failureCodes ?? []))) return true;
  // Summary heuristic only when SDK did not supply failure codes
  if ((input.failureCodes?.length ?? 0) === 0) {
    return summaryLooksLikeVoicemailOrNoAnswer(input.callSummary);
  }
  return false;
}

/**
 * Map CALL-E structured result (or dress-rehearsal preview) → DecisionResult.
 *
 * Rules:
 * - Prefer failureCode / completionConfidence over summary-string heuristics
 * - Identity read-back (stage code) required before accepting 1/2/3 on curtain-up
 * - taskCompleted === true + consistent structured → accept (if identity + confidence OK)
 * - taskCompleted === false → never a normal 1/2/3 (voicemail→no_answer, else unclear)
 * - structured fields that point at *different* options → unclear
 *   (paraphrased decision ids that match no option are ignored)
 * - dress rehearsal may simulate option 1 (identity treated as confirmed)
 */
export function toDecision(input: ToDecisionInput): DecisionResult {
  const { event, options, mode } = input;

  if (input.holdReason) {
    return DecisionResultSchema.parse({
      trigger_id: event.trigger_id,
      account_id: event.account.id,
      account_name: event.account.name,
      cs_owner_id: event.cs_owner.id,
      call_run_id: null,
      decision: "hold",
      decision_label: "HOLD",
      option_id: "hold",
      notes_short: input.holdReason,
      follow_up_at: null,
      completed_at: new Date().toISOString(),
      mode,
      hold_reason: input.holdReason,
    });
  }

  if (input.failure) {
    return DecisionResultSchema.parse({
      trigger_id: event.trigger_id,
      account_id: event.account.id,
      account_name: event.account.name,
      cs_owner_id: event.cs_owner.id,
      call_run_id: input.callRunId ?? null,
      decision: "failure",
      decision_label: `CALL-E failure (${input.failure.category})`,
      option_id: "unknown",
      notes_short: input.failure.summary,
      follow_up_at: null,
      completed_at: new Date().toISOString(),
      mode,
      hold_reason: null,
    });
  }

  const vm = isNoAnswer(input);
  const taskFailed = input.taskCompleted === false;
  const taskOk = input.taskCompleted === true;
  const lowConfidence = isLowCompletionConfidence(input.completionConfidence);

  if (mode === "dress_rehearsal") {
    const sim =
      options.find((o) => o.option_id === (input.simulatedOptionId ?? "1")) ?? options[0];
    const code =
      input.expectedStageCode ??
      (typeof input.intent.metadata?.stage_code === "string"
        ? input.intent.metadata.stage_code
        : null);
    return DecisionResultSchema.parse({
      trigger_id: event.trigger_id,
      account_id: event.account.id,
      account_name: event.account.name,
      cs_owner_id: event.cs_owner.id,
      call_run_id: "dress_rehearsal",
      decision: sim.decision,
      decision_label: sim.decision_label,
      option_id: sim.option_id,
      notes_short: code
        ? `Dress rehearsal preview — no live ring. Stage code would be ${code}.`
        : "Dress rehearsal preview — no live ring.",
      follow_up_at: null,
      completed_at: new Date().toISOString(),
      mode,
      hold_reason: null,
    });
  }

  // SDK said no-answer / voicemail via failureCode — even before taskCompleted
  if (vm && (taskFailed || input.taskCompleted == null) && !input.structured) {
    const notes =
      (input.failureCodes ?? []).join(",") ||
      (input.failureMessages ?? [])[0] ||
      (input.callSummary ? input.callSummary.slice(0, 280) : null);
    return noAnswerResult(input, notes);
  }

  // Incomplete task: never claim a human chose 1/2/3
  if (taskFailed) {
    if (vm) {
      return noAnswerResult(
        input,
        (input.failureCodes ?? []).join(",") ||
          (input.callSummary ? input.callSummary.slice(0, 280) : null),
      );
    }
    return unclearResult(
      input,
      "Unclear — task not completed",
      input.callSummary
        ? input.callSummary.slice(0, 280)
        : "taskCompleted=false; refusing to record a line reading",
    );
  }

  if (lowConfidence) {
    const conf = input.completionConfidence;
    return unclearResult(
      input,
      "Unclear — low completionConfidence",
      conf
        ? `completionConfidence score=${conf.score} label=${conf.label}`
        : "low completionConfidence",
    );
  }

  const parsed = parseStructuredOption(options, input.structured);
  if (parsed.kind === "contradiction") {
    return unclearResult(
      input,
      "Unclear — contradictory structured result",
      input.structured ? JSON.stringify(input.structured).slice(0, 200) : null,
    );
  }

  let matched: DecisionOption | null =
    parsed.kind === "ok" ? parsed.option : null;

  // Prefer structured when taskCompleted is true or unknown; transcript only as fallback
  if (!matched && (taskOk || input.taskCompleted == null)) {
    matched = optionFromTranscript(input.transcriptTexts, options);
  }

  if (!matched) {
    if (vm) {
      return noAnswerResult(
        input,
        (input.failureCodes ?? []).join(",") ||
          (input.callSummary ? input.callSummary.slice(0, 280) : null),
      );
    }
    return DecisionResultSchema.parse({
      trigger_id: event.trigger_id,
      account_id: event.account.id,
      account_name: event.account.name,
      cs_owner_id: event.cs_owner.id,
      call_run_id: input.callRunId ?? null,
      decision: "unclear",
      decision_label: "Could not map line reading",
      option_id: "unknown",
      notes_short: input.callSummary
        ? input.callSummary.slice(0, 280)
        : input.structured
          ? JSON.stringify(input.structured).slice(0, 200)
          : "No structured result from CALL-E",
      follow_up_at: null,
      completed_at: new Date().toISOString(),
      mode,
      hold_reason: null,
    });
  }

  // Identity read-back — bind decision to the call-sheet owner, not whoever answered
  const expectedCode =
    input.expectedStageCode ??
    (typeof input.intent.metadata?.stage_code === "string"
      ? input.intent.metadata.stage_code
      : null);
  if (expectedCode) {
    const idCheck = checkIdentityReadback({
      expectedStageCode: expectedCode,
      structured: input.structured,
      transcriptTexts: input.transcriptTexts,
      dressRehearsal: false,
    });
    if (!idCheck.ok) {
      return unclearResult(
        input,
        "Unclear — identity read-back failed",
        `stage_code expected; identity check=${idCheck.reason}`,
      );
    }
  }

  // taskCompleted must be true to accept a normal decision when SDK provided the flag
  if (input.taskCompleted === true || input.taskCompleted == null) {
    const notesParts: string[] = [];
    if (input.structured && typeof input.structured.notes_short === "string") {
      notesParts.push(input.structured.notes_short);
    }
    if (expectedCode) {
      notesParts.push(`identity:stage_code_ok`);
    }
    if (input.evidence?.length) {
      notesParts.push(`evidence:${input.evidence.slice(0, 2).join("; ").slice(0, 120)}`);
    }
    return DecisionResultSchema.parse({
      trigger_id: event.trigger_id,
      account_id: event.account.id,
      account_name: event.account.name,
      cs_owner_id: event.cs_owner.id,
      call_run_id: input.callRunId ?? null,
      decision: matched.decision,
      decision_label: matched.decision_label,
      option_id: matched.option_id,
      notes_short: notesParts.length ? notesParts.join(" · ").slice(0, 280) : null,
      follow_up_at: null,
      completed_at: new Date().toISOString(),
      mode,
      hold_reason: null,
    });
  }

  return unclearResult(input, "Unclear line reading — no valid 1/2/3", null);
}

export function previewIntentSummary(intent: CallIntent): string {
  const lines = intent.options
    .map((o) => `  ${o.option_id}. ${o.decision_label}`)
    .join("\n");
  const stage =
    typeof intent.metadata?.stage_code === "string"
      ? `Stage code (identity read-back): ${intent.metadata.stage_code}`
      : null;
  return [
    `Persona: ${intent.persona}`,
    `Cue: ${intent.trigger_id}`,
    `Account: ${intent.account_name} (${intent.account_id})`,
    `Call sheet: ${intent.cs_owner_name} (CS only — never customer)`,
    stage,
    `Line readings:`,
    lines,
  ]
    .filter(Boolean)
    .join("\n");
}
