import { findFlight, type Catalog } from "./data.ts";
import type { Booking, BookingState, ChangeRequest, Eligibility, Quote } from "./types.ts";

/** Changes this close to departure cannot be made with the airline in time. */
export const CHANGE_CUTOFF_MINUTES = 60;

export interface EligibilityInput {
  catalog: Catalog;
  booking: Booking;
  state: BookingState | undefined;
  request: Pick<ChangeRequest, "kind" | "targetFlightId">;
  quote: Quote;
  /** True when the flight has a reported disruption; that path owns the booking. */
  disrupted: boolean;
  now: number;
}

/**
 * Step 2 of Workflow B: can this booking code be changed at all, and is the
 * requested option one we can price? Runs before any quote reaches the passenger.
 */
export function checkEligibility(input: EligibilityInput): Eligibility {
  const { catalog, booking, state, request, quote, disrupted, now } = input;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const flight = findFlight(catalog, booking.flightId);
  const minutesToDeparture = (new Date(flight.departure).getTime() - now) / 60_000;

  if (!state || state.status !== "ticketed") {
    reasons.push(`${booking.pnr} was already changed (${state?.status ?? "no booking state"}).`);
  }
  if (disrupted) {
    reasons.push(`${flight.code} has a reported disruption. Handle ${booking.pnr} through the disruption call instead.`);
  }
  if (minutesToDeparture <= 0) {
    reasons.push(`${flight.code} has already departed.`);
  } else if (minutesToDeparture < CHANGE_CUTOFF_MINUTES) {
    reasons.push(`${flight.code} departs in less than ${CHANGE_CUTOFF_MINUTES} minutes, past the change cutoff.`);
  }

  // The passenger picks on the CALL-E call; a flight they named must still be one we can offer.
  if (request.targetFlightId) {
    if (request.kind !== "reschedule") reasons.push("Only a reschedule request can name a flight.");
    else if (!quote.moves.some((m) => m.flightId === request.targetFlightId)) {
      reasons.push(`${request.targetFlightId} is not a later flight on the same route with seats.`);
    }
  }

  if (request.kind === "refund") {
    if (quote.refund.amount === 0) warnings.push("This fare is non-refundable: the refund is IDR 0.");
    else if (quote.refund.amount < quote.refund.gross) warnings.push("The refund is less than the fare paid.");
  }
  if (request.kind === "reschedule") {
    const move = quote.moves.find((m) => m.flightId === request.targetFlightId);
    if (move && move.total > 0) warnings.push("The change has a cost the passenger must accept.");
  }

  return { eligible: reasons.length === 0, reasons, warnings };
}
