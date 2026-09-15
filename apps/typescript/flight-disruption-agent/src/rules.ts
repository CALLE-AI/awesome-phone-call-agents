import { findFlight, type Catalog } from "./data.ts";
import { localTime } from "./format.ts";
import type {
  AirlineRules,
  Booking,
  ChangeCase,
  Disruption,
  IntermediaryRules,
  MoveOption,
  Quote,
  QuoteLine,
} from "./types.ts";

export function airlineOf(catalog: Catalog, booking: Booking): { id: string; rules: AirlineRules } {
  const id = booking.channel[booking.channel.length - 1];
  const rules = id ? catalog.rules.parties[id] : undefined;
  if (!id || !rules || rules.role !== "airline") {
    throw new Error(`Booking ${booking.pnr} channel must end with an airline`);
  }
  return { id, rules };
}

function intermediariesOf(catalog: Catalog, booking: Booking): { id: string; rules: IntermediaryRules }[] {
  return booking.channel.slice(0, -1).map((id) => {
    const rules = catalog.rules.parties[id];
    if (!rules || rules.role === "airline") throw new Error(`Unknown intermediary ${id} on ${booking.pnr}`);
    return { id, rules };
  });
}

/**
 * Which rule set applies. A short delay is still the passenger's own choice to change
 * (voluntary). A long delay or a cancellation is on the airline, unless the cause is
 * force majeure, which most airlines price separately.
 */
export function changeCaseFor(
  catalog: Catalog,
  booking: Booking,
  disruption: Pick<Disruption, "kind" | "cause" | "delayMinutes">,
): ChangeCase {
  const { rules } = airlineOf(catalog, booking);
  if (disruption.kind === "delay" && disruption.delayMinutes < rules.involuntaryDelayMinutes) return "voluntary";
  return disruption.cause === "force_majeure" ? "force_majeure" : "involuntary";
}

const CASE_LABEL: Record<ChangeCase, string> = {
  involuntary: "involuntary",
  force_majeure: "force majeure",
  voluntary: "voluntary",
};

function sum(lines: QuoteLine[]): number {
  return lines.reduce((total, line) => total + line.amount, 0);
}

/**
 * Prices every option for one booking. Each party in the sales chain applies its
 * own rule, which is why the same delay costs different passengers different amounts.
 */
export function quoteFor(catalog: Catalog, booking: Booking, disruption: Disruption): Quote {
  const changeCase = changeCaseFor(catalog, booking, disruption);
  return priceOptions(catalog, booking, changeCase, disruption.kind === "cancellation" ? null : disruption.newDeparture);
}

/**
 * Prices a change the passenger asked for (Workflow B). Nothing happened to the
 * flight, so standard voluntary rules apply and "keep" means the original departure.
 */
export function voluntaryQuoteFor(catalog: Catalog, booking: Booking): Quote {
  const flight = findFlight(catalog, booking.flightId);
  return priceOptions(catalog, booking, "voluntary", flight.departure);
}

function priceOptions(catalog: Catalog, booking: Booking, changeCase: ChangeCase, keepDeparture: string | null): Quote {
  const flight = findFlight(catalog, booking.flightId);
  const airline = airlineOf(catalog, booking);
  const middlemen = intermediariesOf(catalog, booking);
  const family = booking.fareFamily;
  const airlineTerms =
    changeCase === "voluntary"
      ? { ...airline.rules.voluntary[family], waivesFareDifference: false }
      : changeCase === "force_majeure"
        ? airline.rules.forceMajeure
        : airline.rules.involuntary;
  const adminFees = (m: { rules: IntermediaryRules }) =>
    changeCase === "voluntary" ? m.rules.voluntary : changeCase === "force_majeure" ? (m.rules.forceMajeure ?? m.rules.involuntary) : m.rules.involuntary;
  const caseLabel = CASE_LABEL[changeCase];

  const alternatives = catalog.flights
    .filter(
      (f) =>
        f.id !== flight.id &&
        f.origin === flight.origin &&
        f.destination === flight.destination &&
        f.seatsAvailable > 0 &&
        new Date(f.departure) > new Date(flight.departure),
    )
    .sort((a, b) => a.departure.localeCompare(b.departure));

  const moves: MoveOption[] = alternatives.map((alt) => {
    const lines: QuoteLine[] = [];
    const changeFee = airlineTerms.rescheduleFee;
    lines.push({
      party: airline.rules.name,
      label: changeFee === 0 && changeCase !== "voluntary" ? `Change fee (waived, ${caseLabel})` : "Change fee",
      amount: changeFee,
    });
    const difference = Math.max(0, alt.fares[family] - booking.farePaid);
    const waived = airlineTerms.waivesFareDifference;
    if (difference > 0) {
      lines.push({
        party: airline.rules.name,
        label: waived ? `Fare difference (waived, ${caseLabel})` : "Fare difference",
        amount: waived ? 0 : difference,
      });
    }
    for (const m of middlemen) {
      lines.push({ party: m.rules.name, label: "Reschedule admin fee", amount: adminFees(m).rescheduleAdminFee });
    }
    return {
      id: alt.id,
      flightId: alt.id,
      label: `${alt.code} at ${localTime(alt.departure)}${alt.departure.slice(0, 10) !== flight.departure.slice(0, 10) ? " next day" : ""}`,
      departure: alt.departure,
      seatsAvailable: alt.seatsAvailable,
      lines,
      total: sum(lines),
    };
  });

  const refundPercent = airlineTerms.refundPercent;
  const refundLines: QuoteLine[] = [];
  if (refundPercent < 100) {
    refundLines.push({
      party: airline.rules.name,
      label: `Airline keeps ${100 - refundPercent}% (${family} fare)`,
      amount: -Math.round((booking.farePaid * (100 - refundPercent)) / 100),
    });
  }
  for (const m of middlemen) {
    const fee = adminFees(m).refundAdminFee;
    refundLines.push({ party: m.rules.name, label: "Refund admin fee", amount: fee === 0 ? 0 : -fee });
  }
  const refundAmount = Math.max(0, booking.farePaid + sum(refundLines));

  return {
    pnr: booking.pnr,
    changeCase,
    thresholdMinutes: airline.rules.involuntaryDelayMinutes,
    keep: keepDeparture === null ? null : { newDeparture: keepDeparture, total: 0 },
    moves,
    refund: { gross: booking.farePaid, lines: refundLines, amount: refundAmount },
  };
}
