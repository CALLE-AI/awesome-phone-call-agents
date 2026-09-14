import type { CallOutcome, Decision, Quote } from "./types.ts";

export const MIN_CONFIDENCE = 0.7;

/**
 * Turns a finished call into either an automatic action or a human review item.
 * Automatic only when CALL-E explicitly reports the task completed with enough confidence,
 * the passenger explicitly did not ask for a person, and chose an offered, consented option.
 * Anything else goes to a person.
 */
export function decide(outcome: CallOutcome, quote: Quote): Decision {
  if (outcome.state !== "completed") {
    const why = outcome.failureMessage ?? outcome.failureCode ?? outcome.providerStatus;
    return { kind: "review", reasons: [`Call did not complete (${why}). Contact the passenger another way.`] };
  }
  const result = outcome.result;
  if (!result) {
    const reasons = ["No structured result. Read the summary and transcript, then choose an action."];
    if (outcome.hint) reasons.push(outcome.hint);
    return { kind: "review", reasons };
  }

  const reasons: string[] = [];
  if (result.human_requested === "yes") reasons.push("Passenger asked for a human agent.");
  else if (result.human_requested !== "no") reasons.push("Could not confirm the passenger does not want a person.");
  if (result.choice === "undecided") reasons.push("Passenger wants more time to decide.");
  if (result.choice === "unknown") reasons.push("The passenger's choice is unclear.");
  // Only an explicit completion counts; a missing flag is not a yes.
  if (outcome.taskCompleted !== true) {
    reasons.push(outcome.taskCompleted === false ? "CALL-E reports the task was not completed." : "CALL-E did not confirm the task was completed.");
  }
  if (!outcome.confidence) {
    reasons.push("No confidence score was returned.");
  } else if (outcome.confidence.score < MIN_CONFIDENCE) {
    reasons.push(`Low confidence (${outcome.confidence.score.toFixed(2)} < ${MIN_CONFIDENCE}).`);
  }
  if (reasons.length) return { kind: "review", reasons };

  if (result.choice === "keep_delayed_flight") {
    if (!quote.keep) return { kind: "review", reasons: ["The flight is cancelled, but the passenger chose to keep it."] };
    return { kind: "apply", action: { kind: "keep" } };
  }

  if (result.choice === "move_to_other_flight") {
    const option = quote.moves.find((m) => m.flightId === result.selected_flight);
    if (!option) return { kind: "review", reasons: ["Passenger chose a flight that was not offered."] };
    if (option.total > 0 && result.fee_accepted !== "yes") {
      return { kind: "review", reasons: ["The move has a cost and the passenger did not clearly accept it."] };
    }
    return { kind: "apply", action: { kind: "move", optionId: option.id } };
  }

  // refund
  const reduced = quote.refund.amount < quote.refund.gross;
  if (reduced && result.fee_accepted !== "yes") {
    return { kind: "review", reasons: ["The refund is reduced and the passenger did not clearly accept the amount."] };
  }
  return { kind: "apply", action: { kind: "refund" } };
}
