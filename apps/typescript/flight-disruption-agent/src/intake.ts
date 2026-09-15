import { findFlight, type Catalog } from "./data.ts";
import { localDate, localTime, spokenRupiah } from "./format.ts";
import { OTA_NAME } from "./task.ts";
import type { Action, Booking, CallOutcome, ChangeRequest, Quote } from "./types.ts";

export const MIN_INTAKE_CONFIDENCE = 0.7;

function spell(code: string): string {
  return code.split("").join(" ");
}

const CHANNEL_WORDS: Record<ChangeRequest["channel"], string> = {
  chat: "our chat",
  web_form: "our web form",
  phone: "our phone line",
};

/**
 * Workflow B step 2: CALL-E calls the passenger who asked to change a booking, offers every
 * priced option, and records the choice and consent. CALL-E cannot look anything up during the
 * call, so the options and amounts are final. The airline is contacted only after this call.
 */
export function buildIntakeTask(catalog: Catalog, booking: Booking, request: ChangeRequest, quote: Quote): string {
  const flight = findFlight(catalog, booking.flightId);
  const asked =
    request.kind === "refund"
      ? "They asked about a refund."
      : request.kind === "reschedule"
        ? `They asked to move to another flight${request.targetFlightId ? ` (${findFlight(catalog, request.targetFlightId).code} at ${localTime(findFlight(catalog, request.targetFlightId).departure)})` : ""}.`
        : "They asked to change their booking.";
  const moves = quote.moves.length
    ? quote.moves.map((m) => `   - ${m.label}: ${m.total === 0 ? "no cost" : `costs ${spokenRupiah(m.total)}`}.`).join("\n")
    : "   - No later flights have seats. Do not offer this option.";
  const refund =
    quote.refund.amount > 0
      ? `Cancel the trip and receive a refund of ${spokenRupiah(quote.refund.amount)} out of ${spokenRupiah(quote.refund.gross)} paid.`
      : `Cancel the trip. Under this fare there is no refund (0 rupiah). Say this plainly.`;

  return [
    `You are an AI assistant calling on behalf of ${OTA_NAME}, an online travel agency. Say that you are an AI assistant calling for ${OTA_NAME} at the start of the call, and ask to speak with ${booking.passenger}. If someone else answers, do not discuss the booking; ask when ${booking.passenger} can be reached and end politely.`,
    ``,
    `${booking.passenger} contacted ${OTA_NAME} through ${CHANNEL_WORDS[request.channel]}. ${asked} You are calling back to agree the change with them.`,
    ``,
    `Facts you may share with ${booking.passenger}:`,
    `- Booking code: ${spell(booking.pnr)}.`,
    `- Current flight: ${flight.code} from ${flight.originCity} to ${flight.destinationCity} on ${localDate(flight.departure)} at ${localTime(flight.departure)} Jakarta time.`,
    `- This is a change the passenger asked for, so standard change and refund rules apply.`,
    ``,
    `Offer exactly these options:`,
    `1. Move to another flight:`,
    moves,
    `2. ${refund}`,
    `3. Keep the current booking with no change.`,
    ``,
    `Rules for this call:`,
    `- Use only the facts above. For anything else, say a ${OTA_NAME} agent will follow up.`,
    `- If the chosen option has a cost, or the refund is less than the amount paid, state the exact amount and ask for a clear yes before accepting the choice.`,
    `- Explain that ${OTA_NAME} will now arrange the change with the airline and send the confirmation, and that the change is final only once the airline confirms it.`,
    `- Never ask for or accept card numbers, passport numbers, passwords, or one-time codes. Any cost is added to the original booking payment.`,
    `- Do not promise refund timing, compensation, vouchers, or anything not listed above.`,
    `- If the passenger asks for a person, say a ${OTA_NAME} agent will call back, then end politely.`,
    `- If the passenger wants time to decide, say they can contact ${OTA_NAME} again later and end politely.`,
    `- Before ending, read back the passenger's choice and any amount they agreed to.`,
  ].join("\n");
}

/** Per-recipient schema CALL-E fills in after the intake call. */
export function buildIntakeResultSchema(quote: Quote): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["choice", "selected_flight", "fee_accepted", "human_requested", "reason"],
    properties: {
      choice: {
        type: "string",
        enum: ["move_to_other_flight", "refund", "no_change", "undecided", "unknown"],
        description:
          "The option the passenger clearly chose. no_change if they want to keep the booking. undecided if they want more time. unknown if the call did not reach the passenger or the answer is unclear.",
      },
      selected_flight: {
        type: "string",
        enum: [...quote.moves.map((m) => m.flightId), "none"],
        description: "Only when choice is move_to_other_flight: the flight they chose. Otherwise none.",
      },
      fee_accepted: {
        type: "string",
        enum: ["yes", "no", "not_applicable", "unknown"],
        description:
          "yes only if the passenger clearly agreed to the stated cost or reduced refund amount. not_applicable if the chosen option has no cost and a full refund.",
      },
      human_requested: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "yes if the passenger asked to speak with a person or requested a callback from a human agent.",
      },
      reason: {
        type: "string",
        description: "One sentence quoting or closely paraphrasing the passenger's words that support the choice.",
      },
    },
  };
}

export type IntakeDecision =
  | { kind: "confirmed"; action: Action; amount: number; reason: string }
  | { kind: "no_change"; reason: string }
  | { kind: "review"; reasons: string[] };

const text = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * The airline is called only when CALL-E explicitly reports the task completed with enough
 * confidence, the passenger explicitly did not ask for a person, and they chose an offered
 * option with explicit consent to any cost or reduced refund. Anything else goes to a person.
 */
export function decideIntake(outcome: CallOutcome, quote: Quote): IntakeDecision {
  if (outcome.state !== "completed") {
    const why = outcome.failureMessage ?? outcome.failureCode ?? outcome.providerStatus;
    return { kind: "review", reasons: [`The call to the passenger did not complete (${why}). Contact them another way.`] };
  }
  const s = outcome.structured;
  if (!s || typeof s.choice !== "string") {
    const reasons = ["No structured result from the passenger call. Read the summary and transcript."];
    if (outcome.hint) reasons.push(outcome.hint);
    return { kind: "review", reasons };
  }
  const reason = text(s.reason);
  const reasons: string[] = [];
  if (s.human_requested === "yes") reasons.push("Passenger asked for a human agent.");
  else if (s.human_requested !== "no") reasons.push("Could not confirm the passenger does not want a person.");
  if (s.choice === "undecided") reasons.push("Passenger wants more time to decide.");
  if (s.choice === "unknown" || !["move_to_other_flight", "refund", "no_change", "undecided"].includes(s.choice)) {
    reasons.push("The passenger's choice is unclear.");
  }
  if (outcome.taskCompleted !== true) {
    reasons.push(outcome.taskCompleted === false ? "CALL-E reports the task was not completed." : "CALL-E did not confirm the task was completed.");
  }
  if (!outcome.confidence) reasons.push("No confidence score was returned.");
  else if (outcome.confidence.score < MIN_INTAKE_CONFIDENCE) {
    reasons.push(`Low confidence (${outcome.confidence.score.toFixed(2)} < ${MIN_INTAKE_CONFIDENCE}).`);
  }
  if (reasons.length) return { kind: "review", reasons };

  if (s.choice === "no_change") return { kind: "no_change", reason };

  if (s.choice === "move_to_other_flight") {
    const option = quote.moves.find((m) => m.flightId === s.selected_flight);
    if (!option) return { kind: "review", reasons: ["Passenger chose a flight that was not offered."] };
    if (option.total > 0 && s.fee_accepted !== "yes") {
      return { kind: "review", reasons: ["The move has a cost and the passenger did not clearly accept it."] };
    }
    return { kind: "confirmed", action: { kind: "move", optionId: option.id }, amount: option.total, reason };
  }

  const reduced = quote.refund.amount < quote.refund.gross;
  if (reduced && s.fee_accepted !== "yes") {
    return { kind: "review", reasons: ["The refund is reduced and the passenger did not clearly accept the amount."] };
  }
  return { kind: "confirmed", action: { kind: "refund" }, amount: quote.refund.amount, reason };
}
