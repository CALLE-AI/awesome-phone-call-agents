import { useEffect, useRef } from "react";

import type { LiveSimulatorObservationSnapshot } from "./useLiveSimulatorObservation.js";
import { LiveDemoEvidenceRail } from "./LiveDemoEvidenceRail.js";
import { SimulationBadge } from "./SimulationBadge.js";

export interface LiveSimulatorResultProps {
  readonly snapshot: LiveSimulatorObservationSnapshot;
  readonly onRetryStatus?: () => void;
  readonly onFinishReview?: () => void;
  readonly onReplay?: () => void;
}

function terminalHeading(snapshot: LiveSimulatorObservationSnapshot): string | null {
  if (snapshot.status === "complete") return "Live simulated observation complete";
  if (snapshot.status === "recovery") {
    return "Live simulated recovery observed—human confirmation required";
  }
  if (snapshot.status === "incomplete") {
    return "Live simulated observation incomplete—no operational decision made";
  }
  if (snapshot.status === "deleted") return "Protected demo result deleted";
  if (snapshot.status === "expired") return "Protected demo result expired";
  return null;
}

export function LiveSimulatorResult({
  snapshot,
  onRetryStatus,
  onFinishReview,
  onReplay,
}: LiveSimulatorResultProps) {
  const boundaryRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (
      snapshot.focusBoundary === "submission" ||
      snapshot.focusBoundary === "error" ||
      snapshot.focusBoundary === "terminal" ||
      snapshot.focusBoundary === "cleanup"
    ) {
      boundaryRef.current?.focus();
    }
  }, [snapshot.focusBoundary, snapshot.resourceVersion, snapshot.status]);
  if (snapshot.status === "idle") return null;
  const heading = terminalHeading(snapshot);
  const isError = snapshot.status === "submission_error" || snapshot.status === "status_error";
  return (
    <section className="simulator-card live-result" aria-label="Live observation result">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Server-owned live lifecycle</p>
          <h2 ref={boundaryRef} tabIndex={-1}>
            {heading ?? snapshot.message ?? "Live observation in progress"}
          </h2>
        </div>
        <SimulationBadge />
      </div>
      <p role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"}>
        {snapshot.message}
      </p>
      {snapshot.operationId === null ? null : (
        <dl className="result-metadata">
          <div>
            <dt>Operation ID</dt>
            <dd>{snapshot.operationId}</dd>
          </div>
          <div>
            <dt>Resource version</dt>
            <dd>{snapshot.resourceVersion}</dd>
          </div>
          <div>
            <dt>Terminal status</dt>
            <dd>{snapshot.result?.terminalOutcome ?? snapshot.status}</dd>
          </div>
        </dl>
      )}
      {snapshot.canRetryStatus ? (
        <button type="button" onClick={onRetryStatus}>
          Retry status
        </button>
      ) : null}
      {snapshot.result !== null && snapshot.review != null && onFinishReview !== undefined ? (
        <LiveDemoEvidenceRail
          projection={snapshot.result}
          review={snapshot.review}
          cleanup={snapshot.cleanup ?? { status: "idle", message: null }}
          onFinish={onFinishReview}
        />
      ) : snapshot.cleanup?.message == null ? null : (
        <div aria-live="polite" aria-atomic="true">
          <p>{snapshot.cleanup.message}</p>
        </div>
      )}
      {snapshot.result === null ? null : (
        <div className="live-result-sections">
          <section data-evidence-role="source-transcript" aria-labelledby="live-transcript-heading">
            <h3 id="live-transcript-heading">Source transcript</h3>
            <p>Provider-observed transcript evidence is shown before every Reading.</p>
            {snapshot.result.transcript.length === 0 ? (
              <p>No admissible transcript evidence was retained.</p>
            ) : (
              <ol className="source-evidence-list">
                {snapshot.result.transcript.map((turn, index) => (
                  <li key={`${turn.speaker}-${String(index)}`}>
                    <strong>{turn.speaker}</strong>
                    <blockquote>{turn.text}</blockquote>
                  </li>
                ))}
              </ol>
            )}
            <dl className="result-metadata">
              <div>
                <dt>Evidence quality</dt>
                <dd>{snapshot.result.evidence?.quality ?? "unavailable"}</dd>
              </div>
              <div>
                <dt>Custody reference</dt>
                <dd>{snapshot.result.evidence?.opaqueReference ?? "unavailable"}</dd>
              </div>
              <div>
                <dt>DTMF actions</dt>
                <dd>{snapshot.result.dtmfActions ?? "unavailable"}</dd>
              </div>
              <div>
                <dt>Twilio reconciliation</dt>
                <dd>{snapshot.result.twilioReconciliation ?? "unavailable"}</dd>
              </div>
            </dl>
          </section>
          <section data-evidence-role="derived-readings" aria-labelledby="live-readings-heading">
            <h3 id="live-readings-heading">Derived Readings</h3>
            {snapshot.result.readings.length === 0 ? (
              <p>No operational Reading was derived.</p>
            ) : (
              <ul>
                {snapshot.result.readings.map((reading) => (
                  <li key={reading.zoneId} data-reading-zone={reading.zoneId}>
                    {reading.label}: {reading.value ?? "unavailable"}
                    {reading.unit === null ? "" : ` ${reading.unit}`} — {reading.disposition}.
                    Reading status: {reading.status}
                  </li>
                ))}
              </ul>
            )}
            {snapshot.result.auxiliaryStatus == null ? (
              <p>Auxiliary statuses unavailable.</p>
            ) : (
              <dl className="result-metadata" aria-label="Auxiliary statuses">
                <div>
                  <dt>Sound status</dt>
                  <dd>{snapshot.result.auxiliaryStatus.sound}</dd>
                </div>
                <div>
                  <dt>Power status</dt>
                  <dd>{snapshot.result.auxiliaryStatus.power}</dd>
                </div>
                <div>
                  <dt>Battery status</dt>
                  <dd>{snapshot.result.auxiliaryStatus.battery}</dd>
                </div>
                <div>
                  <dt>Output status</dt>
                  <dd>{snapshot.result.auxiliaryStatus.output}</dd>
                </div>
              </dl>
            )}
            <h4>Reconciliation</h4>
            <ul>
              {snapshot.result.reconciliation.map((item) => (
                <li key={item.zoneId}>
                  {item.zoneId}: {item.disposition}
                </li>
              ))}
            </ul>
            {snapshot.result.predecessorOperationId === null ? null : (
              <p>Recovery predecessor: {snapshot.result.predecessorOperationId}</p>
            )}
          </section>
        </div>
      )}
      {snapshot.result !== null &&
      snapshot.result.terminal &&
      snapshot.result.terminalOutcome !== "observation_recorded" &&
      onReplay !== undefined ? (
        <aside className="live-demo-replay-fallback" aria-label="Separate deterministic replay">
          <p>Replay is separate from the exact failed live result and never replaces it.</p>
          <button type="button" onClick={onReplay}>
            Replay deterministic fixture (separate from live result)
          </button>
        </aside>
      ) : null}
      <p className="interpretation-limit">
        This live result remains SIMULATED and simulator-tested only. It does not prove physical
        hardware behavior, production readiness, or native-alarm coexistence.
      </p>
    </section>
  );
}
