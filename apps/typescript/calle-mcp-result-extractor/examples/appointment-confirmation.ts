import { z } from "zod";

/**
 * Example schema for the scenario in fake/sample-call-run.json: confirming a
 * rescheduled appointment by phone. Swap this for whatever your own call
 * actually needs to determine — the schema is the only domain-specific part
 * of this tool.
 */
export const AppointmentConfirmationResult = z.object({
  appointmentConfirmed: z.boolean(),
  newDate: z.string().nullable().describe("ISO-8601 date if stated, otherwise null"),
  newTime: z.string().nullable().describe("Free-text time as stated, otherwise null"),
  prepInstructions: z.string().nullable(),
  requiresCallback: z.boolean().describe("True if the recipient could not confirm on this call"),
});

export type AppointmentConfirmationResult = z.infer<typeof AppointmentConfirmationResult>;

export const QUESTIONS_TO_RESOLVE = [
  "Did the recipient confirm the new appointment date and time?",
  "What is the exact new date and time?",
  "Is there anything the customer needs to do or bring beforehand?",
];

/** What extractStructuredResult should return for the fake transcript above. */
export const EXPECTED_RESULT: AppointmentConfirmationResult = {
  appointmentConfirmed: true,
  newDate: "2026-08-12",
  newTime: "10 AM",
  prepInstructions: "Arrive 15 minutes early for paperwork.",
  requiresCallback: false,
};
