import { useCallback, useState } from "react";
import type { FleetEndpoint, MusterApiClient } from "@muster/api-client";

import { FleetSimulationBadge } from "./FleetSimulationBadge.js";
import { FleetStatusIndicator } from "./FleetStatusIndicator.js";
import { ObservationLifecyclePanel } from "./ObservationLifecyclePanel.js";
import { useObservationLifecycle } from "./useObservationLifecycle.js";

export interface FleetEndpointSummaryProps {
  readonly endpoint: FleetEndpoint;
  readonly lastKnown?: boolean;
  readonly client?: MusterApiClient;
  readonly refreshEndpoint?: (endpointId: string) => Promise<FleetEndpoint | null>;
}

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "long",
  timeZone: "UTC",
});

function Timestamp({ value }: { readonly value: string }) {
  const parsed = new Date(value);
  const label = Number.isNaN(parsed.valueOf())
    ? "Not available"
    : timestampFormatter.format(parsed);
  return <time dateTime={value}>{label}</time>;
}

function showsSimulated(endpoint: FleetEndpoint): boolean {
  return (
    endpoint.provenance === "SIMULATED" ||
    endpoint.lastAttempt?.provenance === "SIMULATED" ||
    endpoint.lastCompleteObservation?.provenance === "SIMULATED"
  );
}

function freshnessLabel(endpoint: FleetEndpoint): string {
  switch (endpoint.freshness.status) {
    case "current":
      return "Current";
    case "stale":
      return "Stale";
    case "not_observed":
      return "Not observed";
    case "unavailable":
      return "Not available";
  }
}

function IncidentSummary({ incident }: { readonly incident: FleetEndpoint["incident"] }) {
  switch (incident.status) {
    case "none":
      return <span>No open incident</span>;
    case "open":
      return <a href={incident.detailPath}>Open incident: {incident.displayLabel}</a>;
    case "unavailable":
      return <span>Incident status unavailable</span>;
  }
}

interface ObservationActionsProps {
  readonly endpoint: FleetEndpoint;
  readonly client: MusterApiClient;
  readonly lastKnown: boolean;
  readonly refreshEndpoint: (endpointId: string) => Promise<FleetEndpoint | null>;
}

function ObservationActions({
  endpoint,
  client,
  lastKnown,
  refreshEndpoint,
}: ObservationActionsProps) {
  const descriptionId = `observation-unavailable-${endpoint.endpointId}`;
  const [expanded, setExpanded] = useState(endpoint.activeManualOperation !== null);
  const refresh = useCallback(
    () => refreshEndpoint(endpoint.endpointId),
    [endpoint.endpointId, refreshEndpoint],
  );
  const lifecycle = useObservationLifecycle({
    endpointId: endpoint.endpointId,
    client,
    activeManualOperation: endpoint.activeManualOperation,
    refreshEndpoint: refresh,
    simulated: showsSimulated(endpoint),
  });
  const showLifecycle = expanded || lifecycle.snapshot.status !== "idle";
  return (
    <>
      <div className="fleet-endpoint__actions">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide details" : "Show details"}
        </button>
        <button
          type="button"
          aria-describedby={descriptionId}
          disabled={lastKnown || !lifecycle.snapshot.canRun}
          onClick={() => {
            setExpanded(true);
            void lifecycle.run();
          }}
        >
          {lifecycle.snapshot.actionLabel}
        </button>
        <span className="visually-hidden" id={descriptionId}>
          {lastKnown
            ? "Refresh Fleet Health before starting an observation."
            : lifecycle.snapshot.canRun
              ? "Starts one manual observation request."
              : "A manual observation request is starting or already in progress."}
        </span>
      </div>
      {showLifecycle ? (
        <ObservationLifecyclePanel
          endpointId={endpoint.endpointId}
          snapshot={lifecycle.snapshot}
          onRetryStatus={lifecycle.retryStatus}
        />
      ) : null}
    </>
  );
}

export function FleetEndpointSummary({
  endpoint,
  lastKnown = false,
  client,
  refreshEndpoint,
}: FleetEndpointSummaryProps) {
  const site = endpoint.siteDisplayName ?? "Site unavailable";
  const label = endpoint.endpointDisplayName ?? "Label unavailable";
  const descriptionId = `observation-unavailable-${endpoint.endpointId}`;
  return (
    <article className="fleet-endpoint" aria-labelledby={`endpoint-${endpoint.endpointId}`}>
      <header className="fleet-endpoint__identity">
        <p className="fleet-endpoint__site">{site}</p>
        <h2 id={`endpoint-${endpoint.endpointId}`}>{label}</h2>
        {showsSimulated(endpoint) ? <FleetSimulationBadge /> : null}
      </header>

      <dl className="fleet-endpoint__facts">
        <div>
          <dt>Operational state</dt>
          <dd>
            <FleetStatusIndicator state={endpoint.operationalState} lastKnown={lastKnown} />
          </dd>
        </div>
        <div>
          <dt>Freshness</dt>
          <dd>
            {freshnessLabel(endpoint)}
            {endpoint.freshness.observedAt === null ? null : (
              <span className="fleet-endpoint__timestamp-detail">
                {" · observed "}
                <Timestamp value={endpoint.freshness.observedAt} />
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Last attempt</dt>
          <dd>
            {endpoint.lastAttempt === null ? (
              "No attempt recorded"
            ) : (
              <Timestamp value={endpoint.lastAttempt.acceptedAt} />
            )}
          </dd>
        </div>
        {endpoint.lastAttempt === null ? null : (
          <>
            <div>
              <dt>Operation ID</dt>
              <dd>{endpoint.lastAttempt.operationId}</dd>
            </div>
            <div>
              <dt>Terminal status</dt>
              <dd>{endpoint.lastAttempt.terminalOutcome ?? endpoint.lastAttempt.stage}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Last complete observation</dt>
          <dd>
            {endpoint.lastCompleteObservation === null ? (
              "No complete observation"
            ) : (
              <Timestamp value={endpoint.lastCompleteObservation.observedAt} />
            )}
          </dd>
        </div>
        <div className="fleet-endpoint__incident">
          <dt>Incident</dt>
          <dd>
            <IncidentSummary incident={endpoint.incident} />
          </dd>
        </div>
      </dl>

      {client === undefined || refreshEndpoint === undefined ? (
        <div className="fleet-endpoint__actions">
          <button type="button" aria-expanded="false" disabled>
            Show details
          </button>
          <button type="button" aria-describedby={descriptionId} disabled>
            Run observation
          </button>
          <span className="visually-hidden" id={descriptionId}>
            Manual observation requires the interactive Fleet Health client.
          </span>
        </div>
      ) : (
        <ObservationActions
          endpoint={endpoint}
          client={client}
          lastKnown={lastKnown}
          refreshEndpoint={refreshEndpoint}
        />
      )}
    </article>
  );
}
