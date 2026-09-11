export const LIVE_DEMO_COPY = Object.freeze({
  invocation: "corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal",
  success: "Live simulated observation complete",
  evidenceRail:
    "CALL-E dispatched -> Twilio synthetic device answered -> transcript admitted -> four readings grounded -> routing safely restored",
  reviewReady: "External call capability closed—review available for 30 minutes",
  finishAction: "Finish demo and delete result",
  deleted: "Protected demo result deleted",
  cleanupAttention: "Cleanup requires attention",
});

export const LIVE_DEMO_BROWSER_STORAGE_ALLOWLIST = Object.freeze([
  "operationId",
  "scenarioId",
  "scenarioRevision",
] as const);

export const LIVE_DEMO_LOG_FACT_ALLOWLIST = Object.freeze([
  "lifecycleState",
  "cleanupOutcome",
  "operationId",
  "scenarioId",
  "scenarioRevision",
  "reviewReadyAt",
  "reviewExpiresAt",
  "opaqueRecoveryId",
  "resourceVersion",
] as const);

export const LIVE_DEMO_PRIVACY_DENYLIST = Object.freeze([
  "permit",
  "transcriptBody",
  "phoneNumber",
  "targetAddress",
  "providerIdentity",
  "providerPayload",
  "callbackPayload",
  "credential",
  "authorizationHeader",
  "rawCustodyPath",
] as const);

export const REQUIRED_LIVE_SUCCESS_FACTS = Object.freeze({
  evidenceClass: "required_live_success_contract",
  isObservedEvidence: false,
  providerDispatchCount: 1,
  signedCallbacks: Object.freeze(["voice", "canary", "status"] as const),
  dtmfCount: 0,
  evidenceRecordCount: 1,
  observationCount: 1,
  groundedReadingCount: 4,
  reconciliationOutcome: "one_matching_completed_call",
  hostedRejectRestored: true,
  ownedCleanupCompleted: true,
});

export const SYNTHETIC_RESULT_FREE_FAILURE_FACTS = Object.freeze({
  evidenceClass: "synthetic_result_free_regression",
  fixtureSource: "privacy_safe_synthetic_fixture",
  safeFailureCode: "provider_evidence_invalid_auxiliary_status",
  evidenceRecordCount: 0,
  observationCount: 0,
  readingCount: 0,
  retryable: false,
  eligibleForLiveSuccess: false,
  readsProtectedLocalEvidence: false,
});

export const LIVE_DEMO_RUBRIC = Object.freeze({
  recordingCeilingSeconds: 180,
  categories: Object.freeze([
    Object.freeze({
      id: "real_world_impact",
      proof: "Legacy greenhouse phone reports no longer require a person to listen and transcribe.",
    }),
    Object.freeze({
      id: "quality_of_idea",
      proof: "CALL-E listens to a synthetic legacy device in a machine-to-machine workflow.",
    }),
    Object.freeze({
      id: "technical_implementation",
      proof:
        "Admitted runtime facts prove signed callbacks, transcript grounding, exact reconciliation, zero DTMF, and safe restoration.",
    }),
    Object.freeze({
      id: "product_experience_and_demo",
      proof:
        "One guarded command opens the exact result, presents transcript before four readings, and visibly deletes it.",
    }),
  ] as const),
  claimCeilings: Object.freeze([
    "SIMULATED",
    "non-production",
    "physical hardware unproven",
  ] as const),
});

function initialRedContract(acceptanceId: string, contractName: string) {
  return Object.freeze({ acceptanceId, contractName, initialRedContract: true as const });
}

export const LIVE_DEMO_MUST_ACCEPTANCE_CONTRACTS = Object.freeze([
  initialRedContract("AC-ENTRY-1", "guarded-command-discoverability"),
  initialRedContract("AC-ENTRY-2", "server-observed-exact-viewer-readiness"),
  initialRedContract("AC-HAPPY-1", "judge-ready-grounded-live-result"),
  initialRedContract("AC-HAPPY-2", "external-capability-closed-before-review"),
  initialRedContract("AC-ERROR-1", "exact-failed-call-remains-result-free"),
  initialRedContract("AC-ERROR-2", "dtmf-and-callback-violations-fail-closed"),
  initialRedContract("AC-ERROR-3", "cleanup-failure-truth-and-recovery"),
  initialRedContract("AC-ASYNC-1", "exact-monotonic-get-only-refresh"),
  initialRedContract("AC-ASYNC-2", "immutable-thirty-minute-review-expiry"),
  initialRedContract("AC-ASYNC-3", "interrupt-and-restart-cleanup-owner"),
  initialRedContract("AC-VERIFY-1", "provider-incapable-review-runtime"),
  initialRedContract("AC-VERIFY-2", "privacy-boundary-denylist"),
  initialRedContract("AC-VERIFY-3", "accessible-recording-safe-review"),
  initialRedContract("AC-VERIFY-4", "distinct-predecessor-evidence-classes"),
  initialRedContract("AC-INTEGRATION-1", "atomic-exact-review-teardown"),
  initialRedContract("AC-INTEGRATION-2", "rubric-visible-with-claim-ceilings"),
  initialRedContract("AC-INTEGRATION-3", "existing-guarded-safety-regression"),
] as const);
