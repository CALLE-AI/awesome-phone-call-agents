import type { ApprovedPreferenceIntakeContract } from "../../domain/dining-preferences.js";
import type { IntakeExecutionContext } from "../../domain/execution-context.js";
import type { PreferenceIntakeProvider } from "./intake-types.js";
import type { ProviderCallResult } from "./types.js";

export type FixtureIntakeScenario = "complete" | "missing";

export class FixturePreferenceIntakeProvider
  implements PreferenceIntakeProvider
{
  readonly name = "fixture-intake";
  callCount = 0;

  constructor(readonly scenario: FixtureIntakeScenario = "complete") {}

  async execute(
    _contract: ApprovedPreferenceIntakeContract,
    _idempotencyKey: string,
    _context: IntakeExecutionContext,
  ): Promise<ProviderCallResult> {
    this.callCount += 1;
    const missingLocation = this.scenario === "missing";
    const preferences = {
      location: missingLocation ? null : "Manhattan, New York",
      cuisine: "Italian",
      date: "2026-09-18",
      time: "19:30",
      timeZone: "America/New_York",
      partySize: 2,
      budget: "upscale",
      atmosphere: "quiet enough to talk, warm, and not stuffy",
      dietaryNeeds: [],
      notes: "A relaxed Friday dinner.",
    };
    const evidence = missingLocation
      ? [
          "The diner requested Italian food for two at 7:30 PM on September 18, but did not choose an area.",
        ]
      : [
          "The diner requested Italian food in Manhattan for two at 7:30 PM on September 18.",
          "The diner wanted somewhere warm and quiet enough to talk, but not stuffy.",
        ];

    return {
      providerCallId: `fixture-intake-${this.callCount}`,
      status: "completed",
      taskCompleted: true,
      completionConfidence: { score: 0.96, label: "high" },
      structuredResult: preferences,
      evidence,
      summary: missingLocation
        ? "The dinner request still needs a location."
        : "Dinner preferences captured and confirmed with the diner.",
      transcript: evidence.map((item) => `diner: ${item}`),
      failureCode: null,
      failureMessage: null,
    };
  }
}
