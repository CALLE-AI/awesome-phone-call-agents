export type Role = "facility" | "parent";

export const facilityResultSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "outcome", "original_practice_time", "original_practice_possible", "field_available_time",
    "player_arrival_time", "conflict_reason", "unresolved_questions", "commitment_requests",
  ],
  properties: {
    outcome: { type: "string", enum: ["confirmed", "unresolved", "no_answer"] },
    original_practice_time: { type: ["string", "null"], maxLength: 40 },
    original_practice_possible: { type: ["boolean", "null"] },
    field_available_time: { type: ["string", "null"], maxLength: 40 },
    player_arrival_time: { type: ["string", "null"], maxLength: 40 },
    conflict_reason: { type: ["string", "null"], maxLength: 160 },
    unresolved_questions: { type: "array", maxItems: 8, items: { type: "string", maxLength: 160 } },
    commitment_requests: { type: "array", maxItems: 8, items: { type: "string", maxLength: 160 } },
  },
} as const;

export const parentResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "attendance", "transportation_needed", "coach_follow_up_requested"],
  properties: {
    outcome: { type: "string", enum: ["response_collected", "uncertain", "no_answer"] },
    attendance: { type: "string", enum: ["attending", "absent", "late", "uncertain", "not_provided"] },
    transportation_needed: { type: "boolean" },
    coach_follow_up_requested: { type: "boolean" },
  },
} as const;

export const facilityObjective = [
  "Open immediately: Hello, this is TeamLine, an automated voice assistant powered by CALL-E, calling with a coach-authorized facility question for Harbor High Lacrosse.",
  "Ask the Athletic Director whether Friday practice at 4:30 PM in Harbor Stadium can still happen, when the field is available, why the original time is unavailable if there is a conflict, and when players may begin arriving.",
  "Clarify incomplete answers and leave unsupported details unresolved. Do not reschedule practice or commit staff, equipment, transportation, spending, or any other team responsibility.",
  "If the recipient asks the team to do something, explain that only the coach can decide and record it in commitment_requests without agreeing or promising.",
  "Before closing, ask whether there is anything else relevant the coach should know. Thank the recipient and end the call.",
].join(" ");

export function parentObjective(change: { from: string; to: string; arrival: string; reason: string }): string {
  return [
    "Open immediately: Hello, this is TeamLine, an automated voice assistant powered by CALL-E, calling with a coach-approved Harbor High Lacrosse practice update.",
    `Tell the Parent or Guardian that Friday practice moved from ${change.from} to ${change.to} at Harbor Stadium because ${change.reason}. Players may arrive at ${change.arrival}.`,
    "Answer relevant questions only from those approved facts. Ask separately whether the player will attend and whether transportation assistance is needed.",
    "Do not arrange transportation, change the schedule, make commitments, or ask for medical or private family details. Return unsupported questions to the coach.",
    "Confirm what was recorded, thank the recipient, and end the call.",
  ].join(" ");
}
