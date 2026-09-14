import { findFlight, type Catalog } from "./data.ts";
import { localDate, localTime, spokenRupiah } from "./format.ts";
import { airlineOf } from "./rules.ts";
import { OTA_NAME } from "./task.ts";
import type { Booking, CallOutcome, MoveOption } from "./types.ts";

export const MIN_AIRLINE_CONFIDENCE = 0.7;

function spell(code: string): string {
  return code.split("").join(" ");
}

export interface ForcedChangeRequest {
  booking: Booking;
  option: MoveOption;
  rejectionCode: string;
  rejectionMessage: string;
}

/**
 * Workflow B step 5: the B2B portal refused a reissue the passenger already agreed
 * to pay for, so the agent phones the airline service desk and asks it to force the change.
 */
export function buildAirlineTask(catalog: Catalog, request: ForcedChangeRequest): string {
  const { booking, option, rejectionCode } = request;
  const airline = airlineOf(catalog, booking).rules;
  const from = findFlight(catalog, booking.flightId);
  const to = findFlight(catalog, option.flightId);
  const airlineFees = option.lines.filter((l) => l.party === airline.name).reduce((t, l) => t + l.amount, 0);

  return [
    `You are an AI assistant calling the ${airline.name} travel agent service desk on behalf of ${OTA_NAME}, an online travel agency. Say that you are an AI assistant calling for ${OTA_NAME} at the start of the call.`,
    ``,
    `Goal: ask the desk to reissue one ticket to a new flight, because the B2B portal refused the change.`,
    ``,
    `Facts you may share:`,
    `- Booking code: ${spell(booking.pnr)}. Ticket number: ${spell(booking.ticket.replace("-", ""))}.`,
    `- Passenger name: ${booking.passenger}.`,
    `- Current flight: ${from.code}, ${from.originCity} to ${from.destinationCity}, ${localDate(from.departure)} at ${localTime(from.departure)} Jakarta time.`,
    `- Requested flight: ${to.code} on ${localDate(to.departure)} at ${localTime(to.departure)} Jakarta time, same fare family (${booking.fareFamily}).`,
    `- The portal returned error ${rejectionCode.replaceAll("_", " ").toLowerCase()}.`,
    `- ${OTA_NAME} expects ${airline.name} fees of ${spokenRupiah(airlineFees)} for this change, including any fare difference.`,
    ``,
    `Rules for this call:`,
    `- Ask the desk to force the reissue to the requested flight. Do not ask for any other flight.`,
    `- Do not agree to any ${airline.name} charge above ${spokenRupiah(airlineFees)}. If the desk asks for more, say ${OTA_NAME} will confirm with the passenger and call back, then end politely.`,
    `- If the desk reissues the ticket, ask for and read back the new booking code, the new ticket number, and a reference for this call.`,
    `- If the desk refuses, ask for the reason in one sentence and end politely.`,
    `- If the desk asks you to call back later or to email, note that and end politely.`,
    `- Never give card numbers, passport numbers, passwords, or one-time codes. ${OTA_NAME} settles fees through its agency account.`,
    `- Use only the facts above. For anything else, say a ${OTA_NAME} agent will follow up.`,
  ].join("\n");
}

export type DeskOutcome = "reissued" | "refused" | "callback_later" | "unknown";

export interface AirlineDeskResult {
  outcome: DeskOutcome;
  new_booking_code: string;
  new_ticket_number: string;
  airline_reference: string;
  extra_charge_requested: "yes" | "no" | "unknown";
  reason: string;
}

export function buildAirlineResultSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "new_booking_code", "new_ticket_number", "airline_reference", "extra_charge_requested", "reason"],
    properties: {
      outcome: {
        type: "string",
        enum: ["reissued", "refused", "callback_later", "unknown"],
        description: "reissued only if the desk confirmed the ticket was reissued to the requested flight.",
      },
      new_booking_code: { type: "string", description: "The new six-character booking code the desk read out, or none." },
      new_ticket_number: { type: "string", description: "The new 13-digit ticket number the desk read out, or none." },
      airline_reference: { type: "string", description: "The desk's reference for this call, or none." },
      extra_charge_requested: {
        type: "string",
        enum: ["yes", "no", "unknown"],
        description: "yes if the desk asked for more than the expected airline fees.",
      },
      reason: { type: "string", description: "One sentence quoting or closely paraphrasing what the desk said." },
    },
  };
}

const OUTCOMES = new Set(["reissued", "refused", "callback_later", "unknown"]);

export function asAirlineDeskResult(value: Record<string, unknown> | null): AirlineDeskResult | null {
  if (!value || typeof value.outcome !== "string" || !OUTCOMES.has(value.outcome)) return null;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : "");
  const charge = String(value.extra_charge_requested);
  return {
    outcome: value.outcome as DeskOutcome,
    new_booking_code: text("new_booking_code").replaceAll(" ", "").toUpperCase(),
    new_ticket_number: text("new_ticket_number").replace(/[\s-]/g, ""),
    airline_reference: text("airline_reference"),
    extra_charge_requested: (charge === "yes" || charge === "no" ? charge : "unknown") as AirlineDeskResult["extra_charge_requested"],
    reason: text("reason"),
  };
}

export type AirlineDecision =
  | { kind: "reissued"; newPnr: string; ticket: string; reference: string }
  | { kind: "review"; reasons: string[] };

/** Only a confirmed reissue with a usable booking code and ticket number updates the booking. */
export function decideAirline(outcome: CallOutcome): AirlineDecision {
  if (outcome.state !== "completed") {
    const why = outcome.failureMessage ?? outcome.failureCode ?? outcome.providerStatus;
    return { kind: "review", reasons: [`Airline desk call did not complete (${why}). Call the desk yourself.`] };
  }
  const result = asAirlineDeskResult(outcome.structured);
  if (!result) {
    const reasons = ["No structured result from the airline desk call. Read the summary and transcript."];
    if (outcome.hint) reasons.push(outcome.hint);
    return { kind: "review", reasons };
  }

  const reasons: string[] = [];
  const said = result.reason.replace(/[.\s]+$/, "");
  if (result.outcome === "refused") reasons.push(`The airline desk refused: ${said || "no reason given"}.`);
  if (result.outcome === "callback_later") reasons.push(`The airline desk asked for a call back: ${said || "no detail"}.`);
  if (result.outcome === "unknown") reasons.push("The airline desk outcome is unclear.");
  if (result.extra_charge_requested === "yes") reasons.push("The desk asked for more than the quoted airline fees.");
  else if (result.extra_charge_requested !== "no") reasons.push("Could not confirm the desk asked for no extra charge.");
  if (outcome.taskCompleted !== true) {
    reasons.push(outcome.taskCompleted === false ? "CALL-E reports the task was not completed." : "CALL-E did not confirm the task was completed.");
  }
  if (!outcome.confidence) reasons.push("No confidence score was returned.");
  else if (outcome.confidence.score < MIN_AIRLINE_CONFIDENCE) {
    reasons.push(`Low confidence (${outcome.confidence.score.toFixed(2)} < ${MIN_AIRLINE_CONFIDENCE}).`);
  }
  if (result.outcome === "reissued") {
    if (!/^[A-Z0-9]{6}$/.test(result.new_booking_code)) reasons.push("The new booking code was not captured clearly.");
    if (!/^\d{13}$/.test(result.new_ticket_number)) reasons.push("The new ticket number was not captured clearly.");
  }
  if (reasons.length) return { kind: "review", reasons };

  const t = result.new_ticket_number;
  return {
    kind: "reissued",
    newPnr: result.new_booking_code,
    ticket: `${t.slice(0, 3)}-${t.slice(3)}`,
    reference: result.airline_reference,
  };
}
