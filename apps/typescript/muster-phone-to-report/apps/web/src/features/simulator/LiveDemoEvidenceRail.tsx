import type {
  SimulatorLiveProjection,
  SimulatorLiveReviewMetadata,
} from "@muster/api-client/simulator-live";

export interface LiveDemoEvidenceRailProps {
  readonly projection: SimulatorLiveProjection;
  readonly review: SimulatorLiveReviewMetadata;
  readonly cleanup: Readonly<{
    status: "idle" | "deleting" | "deleted" | "expired" | "attention";
    message: string | null;
  }>;
  readonly onFinish: () => void;
}

const evidenceSteps = Object.freeze([
  "CALL-E dispatched",
  "Twilio synthetic device answered",
  "transcript admitted",
  "four readings grounded",
  "routing safely restored",
] as const);

function isCompleteGroundedReview(projection: SimulatorLiveProjection): boolean {
  return (
    projection.provenance === "SIMULATED" &&
    projection.terminalOutcome === "observation_recorded" &&
    projection.evidence?.quality === "complete" &&
    projection.transcript.length > 0 &&
    projection.readings.length === 4 &&
    projection.readings.every(({ disposition }) => disposition === "grounded") &&
    projection.reconciliation.length === 4 &&
    projection.reconciliation.every(({ disposition }) => disposition === "matched") &&
    projection.auxiliaryStatus !== null &&
    !Object.values(projection.auxiliaryStatus).includes("unknown")
  );
}

export function LiveDemoEvidenceRail({
  projection,
  review,
  cleanup,
  onFinish,
}: LiveDemoEvidenceRailProps) {
  const complete = review.capabilityClosed && isCompleteGroundedReview(projection);
  return (
    <aside className="live-demo-review" aria-labelledby="live-demo-review-heading">
      <h3 id="live-demo-review-heading">Demo Review</h3>
      <p className="live-demo-review-ready">
        External call capability closed—review available for 30 minutes
      </p>
      <p>
        Fixed expiry: <time dateTime={review.reviewExpiresAt}>{review.reviewExpiresAt}</time>
      </p>
      {complete ? (
        <ol className="live-demo-evidence-rail" aria-label="Verified live evidence lifecycle">
          {evidenceSteps.map((step) => (
            <li key={step} data-evidence-step={step}>
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <p>Live evidence is incomplete; the normal evidence rail is unavailable.</p>
      )}
      <p className="live-demo-claim-ceiling">
        SIMULATED · non-production · physical hardware unproven
      </p>
      <div aria-live="polite" aria-atomic="true">
        {cleanup.message === null ? null : <p>{cleanup.message}</p>}
      </div>
      {cleanup.status === "deleted" ? null : (
        <button type="button" disabled={cleanup.status === "deleting"} onClick={onFinish}>
          {cleanup.status === "deleting"
            ? "Deleting protected demo result…"
            : "Finish demo and delete result"}
        </button>
      )}
    </aside>
  );
}
