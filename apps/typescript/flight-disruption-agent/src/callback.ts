import { findFlight, type Catalog } from "./data.ts";
import { localDate, localTime, spokenRupiah } from "./format.ts";
import { OTA_NAME } from "./task.ts";
import type { Booking, BookingState, CallOutcome, RequestEntry } from "./types.ts";

function spell(code: string): string {
  return code.split("").join(" ");
}

/**
 * Optional last step of Workflow B: tell the passenger how their request ended.
 * The call only reports; it never offers or changes anything.
 */
export function buildCallbackTask(catalog: Catalog, booking: Booking, state: BookingState, entry: RequestEntry): string {
  const lines: string[] = [];
  if (state.status === "rebooked") {
    const flight = findFlight(catalog, state.flightId);
    const paid = state.charges.reduce((t, l) => t + l.amount, 0);
    lines.push(
      `- The change is done. New flight: ${flight.code} from ${flight.originCity} to ${flight.destinationCity} on ${localDate(flight.departure)} at ${localTime(flight.departure)} Jakarta time.`,
      `- New booking code: ${spell(state.currentPnr)}. The e-ticket was reissued and will arrive by email.`,
      `- Amount charged for the change: ${paid === 0 ? "nothing" : spokenRupiah(paid)}, as the passenger agreed.`,
    );
  } else if (state.status === "refunded") {
    lines.push(
      `- The booking was cancelled and the ticket voided.`,
      `- Refund recorded: ${spokenRupiah(state.refundAmount ?? 0)}, as the passenger agreed.`,
    );
  } else {
    lines.push(
      `- ${OTA_NAME} could not make the requested ${entry.request.kind}. The booking is unchanged and still valid for the original flight.`,
      `- A ${OTA_NAME} agent can discuss other options if the passenger replies through ${OTA_NAME}.`,
    );
  }
  return [
    `You are an AI assistant calling on behalf of ${OTA_NAME}, an online travel agency. Say that you are an AI assistant calling for ${OTA_NAME} at the start of the call, and ask to speak with ${booking.passenger}. If someone else answers, do not discuss the booking; ask when ${booking.passenger} can be reached and end politely.`,
    ``,
    `Purpose: tell ${booking.passenger} the result of the ${entry.request.kind} they requested for booking ${spell(booking.pnr)}.`,
    ``,
    `Facts you may share:`,
    ...lines,
    ``,
    `Rules for this call:`,
    `- This call only reports a result. Do not offer, accept, or promise any other change, refund, voucher, or timing.`,
    `- Never ask for or accept card numbers, passport numbers, passwords, or one-time codes.`,
    `- If the passenger disagrees with the result or asks for a person, say a ${OTA_NAME} agent will call back, then end politely.`,
    `- Before ending, ask whether the passenger understood the result.`,
  ].join("\n");
}

export interface CallbackResult {
  reached_passenger: "yes" | "no" | "unknown";
  acknowledged: "yes" | "no" | "unknown";
  follow_up_requested: "yes" | "no" | "unknown";
  reason: string;
}

export function buildCallbackResultSchema(): Record<string, unknown> {
  const tri = (description: string) => ({ type: "string", enum: ["yes", "no", "unknown"], description });
  return {
    type: "object",
    additionalProperties: false,
    required: ["reached_passenger", "acknowledged", "follow_up_requested", "reason"],
    properties: {
      reached_passenger: tri("yes only if the passenger themself was on the call."),
      acknowledged: tri("yes if the passenger said they understood the result."),
      follow_up_requested: tri("yes if the passenger disputed the result or asked for a person."),
      reason: { type: "string", description: "One sentence quoting or closely paraphrasing the passenger." },
    },
  };
}

export type CallbackVerdict = { kind: "delivered" } | { kind: "follow_up"; reasons: string[] };

/** A callback counts as delivered only when the passenger was reached and understood. */
export function decideCallback(outcome: CallOutcome): CallbackVerdict {
  if (outcome.state !== "completed") {
    return { kind: "follow_up", reasons: [`Callback did not complete (${outcome.failureMessage ?? outcome.failureCode ?? outcome.providerStatus}). Send the result in writing.`] };
  }
  const s = outcome.structured;
  if (!s) return { kind: "follow_up", reasons: ["No structured result. Read the summary before closing."] };
  const reasons: string[] = [];
  if (s.reached_passenger !== "yes") reasons.push("The passenger was not clearly reached.");
  if (s.follow_up_requested === "yes") reasons.push(`The passenger wants a person to follow up: ${String(s.reason ?? "")}`.trim());
  else if (s.acknowledged !== "yes") reasons.push("The passenger did not clearly acknowledge the result.");
  return reasons.length ? { kind: "follow_up", reasons } : { kind: "delivered" };
}
