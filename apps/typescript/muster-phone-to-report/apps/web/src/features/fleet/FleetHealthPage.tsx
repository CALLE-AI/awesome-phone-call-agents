import { renderToStaticMarkup } from "react-dom/server";
import type {
  FleetEndpoint,
  FleetHealthResponse,
  FleetSchedulerHeartbeat,
  MusterApiClient,
} from "@muster/api-client";

import { FleetEndpointSummary } from "./FleetEndpointSummary.js";
import { FleetSimulationBadge } from "./FleetSimulationBadge.js";

export interface FleetHealthPageProps {
  readonly fleet: FleetHealthResponse;
  readonly refreshWarning?: boolean;
  readonly client?: MusterApiClient;
  readonly refreshEndpoint?: (endpointId: string) => Promise<FleetEndpoint | null>;
}

function Timestamp({ value }: { readonly value: string }) {
  const parsed = new Date(value);
  const label = Number.isNaN(parsed.valueOf())
    ? "Not available"
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "long",
        timeZone: "UTC",
      }).format(parsed);
  return <time dateTime={value}>{label}</time>;
}

function SchedulerHeartbeat({ heartbeat }: { readonly heartbeat: FleetSchedulerHeartbeat }) {
  if (heartbeat.status === "missing" || heartbeat.status === "unavailable") {
    return (
      <section
        className="fleet-heartbeat fleet-heartbeat--unavailable"
        aria-labelledby="heartbeat-heading"
      >
        <h2 id="heartbeat-heading">Scheduler heartbeat</h2>
        <p>Scheduler heartbeat unavailable. Observation scheduling status is unknown.</p>
      </section>
    );
  }

  const label = heartbeat.status === "current" ? "Current" : "Stale";
  return (
    <section
      className={`fleet-heartbeat fleet-heartbeat--${heartbeat.status}`}
      aria-labelledby="heartbeat-heading"
    >
      <h2 id="heartbeat-heading">Scheduler heartbeat: {label}</h2>
      <p>
        Last heartbeat:{" "}
        {heartbeat.observedAt === null ? (
          "Not available"
        ) : (
          <Timestamp value={heartbeat.observedAt} />
        )}
      </p>
      <p className="fleet-heartbeat__limit">
        Bounded foundation job evidence; not proof of continuous monitoring.
      </p>
    </section>
  );
}

export function FleetHealthPage({
  fleet,
  refreshWarning = false,
  client,
  refreshEndpoint,
}: FleetHealthPageProps) {
  const containsSimulation = fleet.endpoints.some(
    (endpoint) =>
      endpoint.provenance === "SIMULATED" ||
      endpoint.lastAttempt?.provenance === "SIMULATED" ||
      endpoint.lastCompleteObservation?.provenance === "SIMULATED",
  );
  return (
    <main className="fleet-page" id="main-content">
      <header className="fleet-page__header">
        <p className="eyebrow">Evidence-aware fleet visibility</p>
        <h1>Fleet Health</h1>
        <p>Last attempts, complete observations, and uncertainty remain separate facts.</p>
      </header>

      <SchedulerHeartbeat heartbeat={fleet.schedulerHeartbeat} />
      {containsSimulation ? (
        <aside className="fleet-simulation-disclosure">
          <FleetSimulationBadge />
          <p>Simulation demonstrates software flow only. It is not physical hardware evidence.</p>
        </aside>
      ) : null}
      {refreshWarning ? (
        <section className="fleet-refresh-warning" role="alert">
          Fleet Health could not be refreshed. Showing data last updated{" "}
          <Timestamp value={fleet.generatedAt} />.
        </section>
      ) : null}

      <section aria-labelledby="fleet-list-heading">
        <div className="fleet-list-heading">
          <h2 id="fleet-list-heading">Configured endpoints</h2>
          <span>{fleet.endpoints.length}</span>
        </div>
        {fleet.endpoints.length === 0 ? (
          <div className="fleet-empty">
            <h3>No configured endpoints were found</h3>
            <p>Fleet Health is read-only. Endpoint configuration happens outside this view.</p>
          </div>
        ) : (
          <ul className="fleet-list" aria-label="Configured endpoints">
            {fleet.endpoints.map((endpoint) => (
              <li key={endpoint.endpointId}>
                <FleetEndpointSummary
                  endpoint={endpoint}
                  lastKnown={refreshWarning}
                  {...(client === undefined ? {} : { client })}
                  {...(refreshEndpoint === undefined ? {} : { refreshEndpoint })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export async function renderFleetHealthPageMarkup(fleet: FleetHealthResponse): Promise<string> {
  return renderToStaticMarkup(<FleetHealthPage fleet={fleet} />);
}
