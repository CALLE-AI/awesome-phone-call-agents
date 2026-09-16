/**
 * Policy layer.
 *
 * CALL-E has no policy API, so consent boundaries live in two places:
 *   1. Task-string instructions injected before the call (buildPolicyText).
 *   2. Post-call assertions over the transcript/result (assertPolicy).
 *
 * The demo case: "Do NOT agree to any fee. If a fee is required, end politely
 * and report the amount." After the call we assert no fee was agreed; if
 * evidence shows one, the node is flagged needs_user rather than done.
 */

import type { CalleCallOutcome, PolicyConstraints } from "../graph/types.js";

/** Build the policy instruction text appended to a node's goal. */
export function buildPolicyText(policy?: PolicyConstraints): string {
  if (!policy) return "";
  const lines: string[] = [];
  if (policy.noFees) {
    lines.push(
      "Do NOT agree to, authorize, or pay any fee. If a fee is required, do not accept it; politely note the amount and report it back."
    );
  }
  if (policy.doNotDisclose?.length) {
    lines.push(
      `Do NOT read aloud or confirm these sensitive details: ${policy.doNotDisclose.join(
        ", "
      )}.`
    );
  }
  for (const extra of policy.extraInstructions ?? []) {
    lines.push(extra);
  }
  return lines.length ? `\nConstraints:\n- ${lines.join("\n- ")}` : "";
}

/** Words that suggest the agent agreed to / paid a fee. */
const AGREED_FEE_PATTERNS = [
  /\b(yes|sure|okay|ok|go ahead|please do)\b.*\b(charge|fee|pay|payment)\b/i,
  /\b(charge|bill) (it|me|the card) now\b/i,
  /\bi(?:'| a)?ll pay\b/i,
];

/** Words that indicate a fee was merely mentioned (not necessarily agreed). */
const FEE_MENTION = /\b(fee|charge|payment|\$\s?\d+)\b/i;

export interface PolicyResult {
  ok: boolean;
  flags: string[];
}

/**
 * Assert policy constraints against a completed call. Conservative: if a fee
 * was mentioned and we can't clearly show the agent refused it, we flag it.
 */
export function assertPolicy(
  outcome: CalleCallOutcome,
  policy?: PolicyConstraints
): PolicyResult {
  const flags: string[] = [];
  if (!policy) return { ok: true, flags };

  const transcriptText = (outcome.transcript ?? [])
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");
  const evidenceText = (outcome.evidence ?? []).join("\n");
  const haystack = `${transcriptText}\n${evidenceText}`;
  // Agreement must come from the AGENT, so only inspect agent turns for it.
  // The callee offering to charge ("shall I charge it now?") is not agreement.
  const agentText = (outcome.transcript ?? [])
    .filter((t) => t.speaker === "agent")
    .map((t) => t.text)
    .join("\n");
  const resultFlaggedFee =
    outcome.structuredResult?.["fee_mentioned"] === true ||
    typeof outcome.structuredResult?.["fee_mentioned"] === "string";

  if (policy.noFees) {
    const agentAgreed = AGREED_FEE_PATTERNS.some((re) => re.test(agentText));
    const feeMentioned = resultFlaggedFee || FEE_MENTION.test(haystack);
    const agentRefused =
      /\b(not authorized|can't agree|cannot agree|won't (?:pay|agree)|no fee)\b/i.test(
        transcriptText
      );

    if (agentAgreed) {
      flags.push("policy:fee_agreed — agent appears to have agreed to a fee");
    } else if (feeMentioned && !agentRefused) {
      flags.push(
        "policy:fee_unresolved — a fee was mentioned and refusal is not clearly evidenced"
      );
    } else if (feeMentioned && agentRefused) {
      flags.push(
        "policy:fee_reported — a fee was mentioned but the agent declined it (review the amount)"
      );
    }
  }

  return { ok: flags.length === 0, flags };
}
