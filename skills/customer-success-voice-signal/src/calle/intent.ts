import type { AccountEvent, CallIntent, DecisionOption } from "../schemas.js";
import { CallIntentSchema } from "../schemas.js";
import { pickOptions } from "../policy/options.js";
import { formatUntrustedCueBlock } from "./cueContext.js";
import { stageCodeForEvent } from "./stageCode.js";

/** Per-cue result schema so CALL-E fills the stable decision id, not a paraphrase. */
export function buildResultSchema(opts: DecisionOption[]): Record<string, unknown> {
  const decisionIds = opts.map((o) => o.decision);
  const labels = opts.map((o) => o.decision_label);
  return {
    type: "object",
    required: ["option_id", "decision", "decision_label", "stage_code", "identity_confirmed"],
    properties: {
      option_id: {
        type: "string",
        enum: ["1", "2", "3"],
        description: "The closed-set choice the CS owner selected (1, 2, or 3).",
      },
      decision: {
        type: "string",
        enum: decisionIds,
        description: `Stable decision id matching the chosen option. Must be exactly one of: ${decisionIds.join(", ")}. Do not paraphrase.`,
      },
      decision_label: {
        type: "string",
        description: `Human-readable label of the chosen option. Prefer exactly: ${labels.join(" | ")}.`,
      },
      stage_code: {
        type: "string",
        description:
          "The 4-digit stage code the CS owner spoke back for identity read-back (digits only).",
      },
      identity_confirmed: {
        type: "boolean",
        description:
          "True only if the spoken stage_code matched the code given on this call.",
      },
      notes_short: {
        type: "string",
        description: "Optional short note from the CS owner.",
      },
    },
  };
}

/**
 * Build a CALL-E task as the Stage Manager.
 * Never instructs a call to the customer — CS owner only.
 * Cue brief/summary/ticket are wrapped as untrusted data.
 * Includes a spoken stage-code identity read-back before line readings.
 */
export function buildCallIntent(
  event: AccountEvent,
  calleeE164: string,
  options?: DecisionOption[],
): CallIntent {
  const opts = options ?? event.option_set ?? pickOptions(event.trigger_id);
  if (opts.length !== 3) {
    throw new Error("Stage Manager requires exactly 3 closed-set line readings (1/2/3).");
  }

  const stageCode = stageCodeForEvent(event);
  const lines = opts
    .map((o) => `${o.option_id}: ${o.decision_label}`)
    .join("\n");

  const cueBlock = formatUntrustedCueBlock({
    brief: event.brief,
    summary: event.summary,
    ticketId: event.ticket_id,
  });

  const task = [
    `You are the Stage Manager. Warm, brief, headset energy — not corporate.`,
    `Call the Customer Success owner only. Never call the end customer.`,
    `Open: "Hi ${event.cs_owner.name}. Stage Manager. You're up for ${event.account.name}."`,
    `One short apology for the interrupt, then paraphrase the cue sheet in your own words (no secret dumps, no internal ids).`,
    cueBlock,
    `Identity read-back (required before any decision): say "Stage code — please repeat: ${stageCode.split("").join(" ")}." Wait for them to say the digits.`,
    `If they cannot or will not repeat the stage code, apologize once, do not offer line readings, hang up. Do not invent a decision.`,
    `Only after the stage code is confirmed, say: "Line reading. Say 1, 2, or 3 — or one, two, or three."`,
    `Speak ONLY these three options — do not invent options, do not read database field names like decision=…:`,
    lines,
    `If they say anything other than 1, 2, or 3, ask once more for 1, 2, or 3, then hang up if still unclear.`,
    `Confirm the choice in one sentence, say you're logging it to the prompt book, then: "Clear. Break a leg — or just open the ticket." Hang up.`,
    `Voicemail / automated unavailable: brief "Stage Manager will try again," hang up. Do not invent a line reading.`,
    `Fill structured result: stage_code (digits they spoke), identity_confirmed (true only on match), option_id ("1"|"2"|"3"), decision (exactly one of: ${opts.map((o) => o.decision).join(" | ")} — do not paraphrase), and decision_label for the chosen line only.`,
  ]
    .filter(Boolean)
    .join("\n");

  return CallIntentSchema.parse({
    persona: "Stage Manager",
    trigger_id: event.trigger_id,
    account_id: event.account.id,
    account_name: event.account.name,
    cs_owner_id: event.cs_owner.id,
    cs_owner_name: event.cs_owner.name,
    callee_e164: calleeE164,
    task,
    options: opts,
    result_schema: buildResultSchema(opts),
    never_call_customer: true,
    metadata: {
      event_id: event.event_id,
      ticket_id: event.ticket_id ?? null,
      severity: event.severity,
      stage_code: stageCode,
    },
  });
}
