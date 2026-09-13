import type { ApprovedBookingContract } from "../../domain/booking-contract.js";
import type { BookingExecutionContext } from "../../domain/execution-context.js";
import type {
  BookingCallProvider,
  ProviderCallResult,
} from "./types.js";

export type FixtureScenario =
  | "confirmed"
  | "unavailable"
  | "alternative"
  | "voicemail"
  | "contradiction";

export class FixtureBookingProvider implements BookingCallProvider {
  readonly name = "fixture";
  callCount = 0;

  constructor(readonly scenario: FixtureScenario) {}

  async execute(
    contract: ApprovedBookingContract,
    _idempotencyKey: string,
    _context: BookingExecutionContext,
  ): Promise<ProviderCallResult> {
    this.callCount += 1;
    const base = {
      providerCallId: `fixture-${this.callCount}`,
      status: "completed" as const,
      taskCompleted: true,
      completionConfidence: { score: 0.97, label: "high" },
      failureCode: null,
      failureMessage: null,
    };

    if (this.scenario === "confirmed") {
      const confirmation = [
        "The reservation is confirmed",
        `for ${contract.reservation.partySize}`,
        `on ${contract.reservation.date}`,
        `at ${contract.reservation.time}`,
      ].join(" ");
      return {
        ...base,
        structuredResult: {
          outcome: "confirmed",
          confirmedDate: contract.reservation.date,
          confirmedTime: contract.reservation.time,
          confirmedPartySize: contract.reservation.partySize,
          confirmationCode: "FIXTURE-42",
          alternativeDate: null,
          alternativeTime: null,
          notes: "Requested reservation confirmed.",
        },
        evidence: [confirmation],
        summary: confirmation,
        transcript: [`restaurant: ${confirmation}`],
      };
    }

    if (this.scenario === "unavailable") {
      return {
        ...base,
        structuredResult: emptyResult("unavailable", "No availability."),
        evidence: ["The requested time is unavailable and no alternative was offered."],
        summary: "Requested slot unavailable.",
        transcript: ["restaurant: We have no availability for that time."],
      };
    }

    if (this.scenario === "alternative") {
      return {
        ...base,
        structuredResult: {
          ...emptyResult("alternative_offered", "Alternative offered but not booked."),
          alternativeDate: contract.reservation.date,
          alternativeTime: "20:00",
        },
        evidence: [
          `The requested time is unavailable; ${contract.reservation.date} at 20:00 was offered as an alternative and not booked.`,
        ],
        summary: "Alternative offered, not booked.",
        transcript: ["restaurant: We could offer 20:00 instead."],
      };
    }

    if (this.scenario === "voicemail") {
      return {
        ...base,
        taskCompleted: false,
        completionConfidence: { score: 0.99, label: "high" },
        structuredResult: emptyResult("unreached", "Reached voicemail; no message left."),
        evidence: ["The call reached voicemail and no message was left."],
        summary: "Restaurant not reached.",
        transcript: ["system: Voicemail greeting detected."],
      };
    }

    return {
      ...base,
      structuredResult: {
        outcome: "confirmed",
        confirmedDate: contract.reservation.date,
        confirmedTime: contract.reservation.time,
        confirmedPartySize: contract.reservation.partySize,
        confirmationCode: null,
        alternativeDate: null,
        alternativeTime: null,
        notes: "Structured output claims confirmation.",
      },
      evidence: ["The restaurant said the requested time is unavailable and not confirmed."],
      summary: "The slot was not confirmed.",
      transcript: ["restaurant: Sorry, that is unavailable."],
    };
  }
}

function emptyResult(outcome: string, notes: string) {
  return {
    outcome,
    confirmedDate: null,
    confirmedTime: null,
    confirmedPartySize: null,
    confirmationCode: null,
    alternativeDate: null,
    alternativeTime: null,
    notes,
  };
}
