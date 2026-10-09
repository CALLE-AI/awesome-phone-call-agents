// Canned scenarios for the FakeCalle dry-run path (demo + tests).
// EVERY number here is in the North American reserved-fictional range (555-0100..0199)
// so no real number can ever touch this repo or its git history.

import type { CalleCallResult } from "./types";

/** A demo-safe fictional pharmacy number. */
export const DEMO_PHARMACY = "+12025550142";

/** Happy path: refill ready, times confirmed, grounded in what the callee said. */
export const pharmacyReadyScenario: CalleCallResult = {
  status: "completed",
  taskCompleted: true,
  completionConfidence: { score: 0.88, label: "high" },
  summary: "Pharmacy confirmed the metformin refill is ready; pickup before 5:00 PM; closes 9:00 PM.",
  evidence: [
    "Pharmacy staff confirmed the metformin refill is ready for pickup",
    "Pickup any time before 5:00 PM; the pharmacy closes at 9:00 PM",
  ],
  structuredResult: {
    refill_ready: "yes",
    pickup_by: "5:00 PM",
    closing_time: "9:00 PM",
  },
  transcriptTurns: [
    { offsetSeconds: 0, speaker: "bot", text: "Hi, I'm an assistant calling on a customer's behalf to check a prescription refill." },
    { offsetSeconds: 8, speaker: "user", text: "Sure, let me look. Yes, the metformin refill is ready for pickup." },
    { offsetSeconds: 15, speaker: "bot", text: "Thank you. Until what time can it be picked up today, and when do you close?" },
    { offsetSeconds: 22, speaker: "user", text: "You can pick it up any time before 5:00 PM, and we close at 9:00 PM." },
  ],
};

/** No-answer: the office could not be reached — everything must fail closed. */
export const noAnswerScenario: CalleCallResult = {
  status: "failed",
  taskCompleted: false,
  completionConfidence: { score: 0, label: "none" },
  summary: "No answer after several rings.",
  transcriptTurns: [],
};
