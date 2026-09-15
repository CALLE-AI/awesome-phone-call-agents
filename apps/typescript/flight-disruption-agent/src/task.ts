import { findFlight, type Catalog } from "./data.ts";
import { duration, localDate, localTime, spokenRupiah } from "./format.ts";
import type { Booking, Disruption, Quote } from "./types.ts";

export const OTA_NAME = "TripKita";

function spell(code: string): string {
  return code.split("").join(" ");
}

/**
 * Everything the voice agent may say is decided here, before the call.
 * CALL-E cannot look anything up mid-call, so the options and prices are final.
 */
export function buildTask(catalog: Catalog, booking: Booking, disruption: Disruption, quote: Quote): string {
  const flight = findFlight(catalog, booking.flightId);
  const scheduled = `Flight ${flight.code} from ${flight.originCity} to ${flight.destinationCity} on ${localDate(flight.departure)}, scheduled at ${localTime(flight.departure)} Jakarta time,`;
  const what =
    disruption.kind === "cancellation" || !disruption.newDeparture
      ? `- ${scheduled} is cancelled because of ${disruption.reason}. It will not operate.`
      : `- ${scheduled} is delayed by ${duration(disruption.delayMinutes)} because of ${disruption.reason}. New departure: ${localTime(disruption.newDeparture)} Jakarta time.`;
  const rules =
    quote.changeCase === "voluntary"
      ? `- The delay is shorter than ${duration(quote.thresholdMinutes)}, so standard change and refund rules apply.`
      : quote.changeCase === "force_majeure"
        ? `- The cause is outside the airline's control (force majeure). The airline change fee is waived, but a fare difference may apply, and no compensation is offered.`
        : disruption.kind === "cancellation"
          ? `- The airline cancelled the flight, so it treats this as an airline-caused change and reduced fees apply.`
          : `- The delay is longer than ${duration(quote.thresholdMinutes)}, so the airline treats it as an airline-caused change and reduced fees apply.`;

  const moveLines = quote.moves.length
    ? quote.moves
        .map((m) => `   - ${m.label}: ${m.total === 0 ? "no cost" : `costs ${spokenRupiah(m.total)}`}.`)
        .join("\n")
    : "   - No other flights have seats. Do not offer this option.";

  const refund =
    quote.refund.amount > 0
      ? `Cancel the trip and receive a refund of ${spokenRupiah(quote.refund.amount)} out of ${spokenRupiah(quote.refund.gross)} paid.`
      : `Cancel the trip. Under this fare there is no refund (0 rupiah). Say this plainly.`;

  const options: string[] = [];
  if (quote.keep) options.push(`Keep the delayed flight at ${localTime(quote.keep.newDeparture)}. No cost.`);
  options.push(`Move to another flight:\n${moveLines}`);
  options.push(refund);
  const count = ["", "one", "two", "three"][options.length];

  return [
    `You are an AI assistant calling on behalf of ${OTA_NAME}, an online travel agency, about a flight booking. Say that you are an AI assistant calling for ${OTA_NAME} at the start of the call, and ask to speak with ${booking.passenger}. If someone else answers, do not discuss the booking; ask when ${booking.passenger} can be reached and end politely.`,
    ``,
    `Facts you may share with ${booking.passenger}:`,
    `- Booking code: ${spell(booking.pnr)}.`,
    what,
    rules,
    ``,
    `Offer exactly these ${count} options:`,
    ...options.map((o, i) => `${i + 1}. ${o}`),
    ``,
    `Rules for this call:`,
    `- Use only the facts above. For anything else, say a ${OTA_NAME} agent will follow up.`,
    `- If the chosen option has a cost, or the refund is less than the amount paid, state the exact amount and ask for a clear yes before accepting the choice.`,
    `- Never ask for or accept card numbers, passport numbers, passwords, or one-time codes.`,
    `- Do not promise refund timing, compensation, vouchers, or anything not listed above.`,
    `- If the passenger asks for a person, say a ${OTA_NAME} agent will call back, then end politely.`,
    `- If the passenger wants time to decide, say they can reply later through ${OTA_NAME} and end politely.`,
    `- Before ending, read back the passenger's choice and any amount they agreed to.`,
  ].join("\n");
}

/** Per-recipient schema CALL-E fills in after the call ends. */
export function buildResultSchema(quote: Quote): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["choice", "selected_flight", "fee_accepted", "human_requested", "reason"],
    properties: {
      choice: {
        type: "string",
        enum: [...(quote.keep ? ["keep_delayed_flight"] : []), "move_to_other_flight", "refund", "undecided", "unknown"],
        description:
          "The option the passenger clearly chose. Use undecided if they want more time. Use unknown if the call did not reach the passenger or the answer is unclear.",
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
