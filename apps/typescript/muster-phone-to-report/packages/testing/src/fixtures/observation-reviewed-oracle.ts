export interface ObservationReviewedOracleEntry {
  readonly fixtureId: "simulated_complete_alpha" | "simulated_complete_beta";
  readonly quality: "complete";
  readonly dispositions: readonly ["grounded", "grounded"];
  readonly values: readonly [string, string];
}

// This reviewed oracle is intentionally separate from source fixtures and is never accepted by
// production reconciliation. Tests compare against it only after derivation has completed.
export const OBSERVATION_REVIEWED_ORACLE: readonly ObservationReviewedOracleEntry[] = Object.freeze(
  [
    Object.freeze({
      fixtureId: "simulated_complete_alpha",
      quality: "complete",
      dispositions: Object.freeze(["grounded", "grounded"] as const),
      values: Object.freeze(["71.5", "68.0"] as const),
    }),
    Object.freeze({
      fixtureId: "simulated_complete_beta",
      quality: "complete",
      dispositions: Object.freeze(["grounded", "grounded"] as const),
      values: Object.freeze(["73.25", "69.5"] as const),
    }),
  ],
);
