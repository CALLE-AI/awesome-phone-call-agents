import { useCallback, useEffect, useMemo, useState } from "react";
import type { FleetEndpoint, FleetHealthResponse, MusterApiClient } from "@muster/api-client";

import { MusterLogo } from "./components/MusterLogo.js";
import { FleetHealthPage } from "./features/fleet/FleetHealthPage.js";
import { createWebApiClient } from "./lib/api-client.js";

type FleetLoadState =
  | Readonly<{ readonly status: "loading"; readonly fleet?: undefined }>
  | Readonly<{ readonly status: "ready"; readonly fleet: FleetHealthResponse }>
  | Readonly<{ readonly status: "refresh_error"; readonly fleet: FleetHealthResponse }>
  | Readonly<{ readonly status: "error"; readonly fleet?: undefined }>;

export interface AppProps {
  readonly client?: MusterApiClient;
}

export function App({ client: suppliedClient }: AppProps) {
  const client = useMemo(() => suppliedClient ?? createWebApiClient(), [suppliedClient]);
  const [state, setState] = useState<FleetLoadState>({ status: "loading" });

  const loadFleet = useCallback(async (): Promise<FleetHealthResponse | null> => {
    const result = await client.getFleetHealth();
    setState((previous) => {
      if (result.ok) return { status: "ready", fleet: result.data };
      if (previous.status === "ready" || previous.status === "refresh_error") {
        return { status: "refresh_error", fleet: previous.fleet };
      }
      return { status: "error" };
    });
    return result.ok ? result.data : null;
  }, [client]);

  const refreshEndpoint = useCallback(
    async (endpointId: string): Promise<FleetEndpoint | null> => {
      const fleet = await loadFleet();
      return fleet?.endpoints.find((endpoint) => endpoint.endpointId === endpointId) ?? null;
    },
    [loadFleet],
  );

  useEffect(() => {
    let active = true;
    void client.getFleetHealth().then((result) => {
      if (!active) return;
      setState(result.ok ? { status: "ready", fleet: result.data } : { status: "error" });
    });
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <div className="application-shell">
      <a className="skip-link" href="#main-content">
        Skip to Fleet Health
      </a>
      <header className="application-header">
        <MusterLogo size={32} />
        <nav aria-label="Primary navigation">
          <a aria-current="page" href="/fleet">
            Fleet Health
          </a>
        </nav>
      </header>
      {state.status === "loading" ? (
        <main className="fleet-page" id="main-content" aria-busy="true">
          <h1>Fleet Health</h1>
          <p role="status" aria-live="polite">
            Loading Fleet Health…
          </p>
        </main>
      ) : state.status === "error" ? (
        <main className="fleet-page" id="main-content">
          <section className="fleet-page-error" role="alert">
            <h1>Fleet Health is unavailable</h1>
            <p>We couldn’t load endpoint status. Try again.</p>
            <button type="button" onClick={() => void loadFleet()}>
              Retry Fleet Health
            </button>
          </section>
        </main>
      ) : (
        <FleetHealthPage
          fleet={state.fleet}
          refreshWarning={state.status === "refresh_error"}
          client={client}
          refreshEndpoint={refreshEndpoint}
        />
      )}
    </div>
  );
}
