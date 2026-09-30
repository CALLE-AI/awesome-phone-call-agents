import { useEffect, useRef } from "react";

import { FleetSimulationBadge } from "./FleetSimulationBadge.js";
import type { ObservationLifecycleSnapshot } from "./useObservationLifecycle.js";

export interface ObservationLifecyclePanelProps {
  readonly endpointId: string;
  readonly snapshot: ObservationLifecycleSnapshot;
  readonly onRetryStatus: () => Promise<void>;
}

export function ObservationLifecyclePanel({
  endpointId,
  snapshot,
  onRetryStatus,
}: ObservationLifecyclePanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (snapshot.focusRequested) heading.current?.focus();
  }, [snapshot.focusRequested, snapshot.resourceVersion, snapshot.status]);

  if (snapshot.status === "idle") return null;
  const alert =
    snapshot.status === "admission_error" ||
    snapshot.status === "poll_error" ||
    snapshot.status === "incomplete";
  const result = snapshot.result;
  return (
    <section
      className={`observation-lifecycle observation-lifecycle--${snapshot.status}`}
      aria-labelledby={`observation-lifecycle-${endpointId}`}
    >
      <h3 id={`observation-lifecycle-${endpointId}`} ref={heading} tabIndex={-1}>
        Observation status
      </h3>
      <p role={alert ? "alert" : "status"} aria-live={alert ? "assertive" : "polite"}>
        {snapshot.message}
      </p>
      {snapshot.simulated ? <FleetSimulationBadge /> : null}
      {snapshot.canRetryStatus ? (
        <button type="button" onClick={() => void onRetryStatus()}>
          Retry status check
        </button>
      ) : null}
      {result?.observation !== null && result?.observation !== undefined ? (
        <div className="observation-lifecycle__result">
          <dl>
            <div>
              <dt>Quality</dt>
              <dd>{result.observation.quality}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>{result.observation.evidenceId}</dd>
            </div>
            <div>
              <dt>Adapter</dt>
              <dd>{result.observation.adapterVersionId}</dd>
            </div>
            <div>
              <dt>Extractor</dt>
              <dd>{result.observation.extractorVersionId}</dd>
            </div>
          </dl>
          {result.observation.readings.length === 0 ? (
            <p>No retained readings were returned.</p>
          ) : (
            <ul aria-label="Observation readings">
              {result.observation.readings.map((reading) => (
                <li key={`${reading.zoneId}-${String(reading.ordinal)}`}>
                  {reading.zoneId}: {reading.value ?? reading.disposition}
                  {reading.normalizedUnit === null ? "" : ` ${reading.normalizedUnit}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
