import { readFile } from "node:fs/promises";

import type { FleetEndpoint, FleetHealthResponse } from "@muster/api-client";
import { describe, expect, it } from "vitest";

interface FleetHealthPageModule {
  readonly renderFleetHealthPageMarkup: (fleet: FleetHealthResponse) => Promise<string>;
}

interface RouterModule {
  readonly resolveFleetRoute: (pathname: string) => "/fleet";
}

async function loadFleetPage(): Promise<FleetHealthPageModule> {
  const moduleUrl = new URL("./FleetHealthPage.tsx", import.meta.url).href;
  const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<FleetHealthPageModule>;
  if (loaded.renderFleetHealthPageMarkup === undefined) {
    throw new Error("renderFleetHealthPageMarkup is not implemented");
  }
  return loaded as FleetHealthPageModule;
}

function endpoint(
  state: FleetEndpoint["operationalState"],
  options: {
    readonly incident?: "none" | "open" | "unavailable";
    readonly simulated?: boolean;
  } = {},
): FleetEndpoint {
  return {
    endpointId: `endpoint-${state}`,
    siteDisplayName: `North ${state}`,
    endpointDisplayName: `${state} monitor`,
    provenance: options.simulated === true ? "SIMULATED" : "PROVIDER_OBSERVED",
    operationalState: state,
    freshness: {
      status:
        state === "normal_observed"
          ? "current"
          : state === "stale"
            ? "stale"
            : state === "not_observed"
              ? "not_observed"
              : "unavailable",
      observedAt: state === "not_observed" ? null : "2026-08-08T18:30:00Z",
      expiresAt: state === "normal_observed" ? "2026-08-08T19:30:00Z" : null,
      windowSeconds: state === "not_observed" ? null : 3600,
    },
    lastAttempt: {
      operationId: `operation-${state}`,
      resourceVersion: 2,
      trigger: "scheduled",
      provenance: options.simulated === true ? "SIMULATED" : "PROVIDER_OBSERVED",
      acceptedAt: "2026-08-08T18:32:00Z",
      lastTransitionAt: "2026-08-08T18:33:00Z",
      stage: "terminal",
      terminalOutcome: state === "unreachable" ? "no_answer" : "observation_recorded",
      retryable: state === "unreachable",
      observationQuality: state === "observation_incomplete" ? "unknown" : "complete",
    },
    lastCompleteObservation:
      state === "not_observed"
        ? null
        : {
            observationId: `observation-${state}`,
            operationId: `operation-${state}`,
            version: 1,
            observedAt: "2026-08-08T18:30:00Z",
            completedAt: "2026-08-08T18:33:00Z",
            provenance: options.simulated === true ? "SIMULATED" : "PROVIDER_OBSERVED",
            evidenceId: `evidence-${state}`,
            adapterVersionId: "adapter-v1",
            extractorVersionId: "extractor-v1",
            reconciliationPolicyVersion: "policy-v1",
          },
    activeManualOperation: null,
    incident:
      options.incident === "none"
        ? { status: "none" }
        : options.incident === "open"
          ? {
              status: "open",
              incidentId: "incident-open",
              openedAt: "2026-08-08T18:35:00Z",
              displayLabel: "Pump room alert",
              detailPath: "/incidents/incident-open",
            }
          : { status: "unavailable" },
  };
}

function fleet(endpoints: readonly FleetEndpoint[]): FleetHealthResponse {
  return {
    contractVersion: "1",
    generatedAt: "2026-08-08T18:40:00Z",
    schedulerHeartbeat: {
      status: "current",
      observedAt: "2026-08-08T18:39:00Z",
      checkOutcome: "ready",
      evidenceKind: "foundation_health_job_completion",
    },
    endpoints: [...endpoints],
  };
}

describe("FleetHealthPage", () => {
  it("routes root and unknown production locations to /fleet", async () => {
    const moduleUrl = new URL("../../router.tsx", import.meta.url).href;
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<RouterModule>;
    if (loaded.resolveFleetRoute === undefined)
      throw new Error("resolveFleetRoute is not implemented");

    expect(loaded.resolveFleetRoute("/")).toBe("/fleet");
    expect(loaded.resolveFleetRoute("/fleet")).toBe("/fleet");
    expect(loaded.resolveFleetRoute("/unexpected")).toBe("/fleet");
  });

  it("renders every collapsed endpoint fact and keeps all non-normal states out of normal semantics", async () => {
    const module = await loadFleetPage();
    const markup = await module.renderFleetHealthPageMarkup(
      fleet([
        endpoint("normal_observed"),
        endpoint("unreachable"),
        endpoint("stale"),
        endpoint("observation_incomplete"),
        endpoint("not_observed"),
      ]),
    );

    expect(markup).toContain("<h1>Fleet Health</h1>");
    expect(markup).toContain('aria-label="Configured endpoints"');
    for (const label of [
      "Normal observed",
      "Unreachable",
      "Stale",
      "Observation incomplete",
      "Not observed",
      "Last attempt",
      "Last complete observation",
      "Run observation",
    ]) {
      expect(markup).toContain(label);
    }
    for (const state of ["unreachable", "stale", "observation_incomplete", "not_observed"]) {
      expect(markup).not.toMatch(
        new RegExp(`data-state="${state}"[^>]*(?:status-normal|Healthy)`, "iu"),
      );
    }
  });

  it("keeps SIMULATED visible and explicitly separated from physical hardware evidence", async () => {
    const module = await loadFleetPage();
    const markup = await module.renderFleetHealthPageMarkup(
      fleet([endpoint("normal_observed", { simulated: true })]),
    );

    expect(markup).toContain("SIMULATED");
    expect(markup).toContain('data-provenance="simulated"');
    expect(markup).toContain('aria-label="Simulated data—not physical hardware evidence"');
    expect(markup).not.toMatch(/hardware verified|production compatible/iu);
  });

  it("distinguishes heartbeat evidence and incident none from unavailable", async () => {
    const module = await loadFleetPage();
    const current = await module.renderFleetHealthPageMarkup(
      fleet([
        endpoint("normal_observed", { incident: "none" }),
        endpoint("observation_incomplete", { incident: "open" }),
        endpoint("stale", { incident: "unavailable" }),
      ]),
    );
    const unavailable = await module.renderFleetHealthPageMarkup({
      ...fleet([]),
      schedulerHeartbeat: {
        status: "unavailable",
        observedAt: null,
        checkOutcome: null,
        evidenceKind: "foundation_health_job_completion",
      },
    });

    expect(current).toContain("Scheduler heartbeat: Current");
    expect(current).toContain("No open incident");
    expect(current).toContain('href="/incidents/incident-open"');
    expect(current).toContain("Open incident: Pump room alert");
    expect(current).toContain("Incident status unavailable");
    expect(unavailable).toContain(
      "Scheduler heartbeat unavailable. Observation scheduling status is unknown.",
    );
    expect(unavailable).not.toMatch(/scheduler healthy|continuous monitoring/iu);
  });

  it("keeps incident rendering exhaustive and Fleet Health product casing exact", async () => {
    const [summarySource, appSource] = await Promise.all([
      readFile(new URL("./FleetEndpointSummary.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../App.tsx", import.meta.url), "utf8"),
    ]);

    expect(summarySource).toContain("switch (incident.status)");
    expect(summarySource).toMatch(/case\s+["']none["']/u);
    expect(summarySource).toMatch(/case\s+["']open["']/u);
    expect(summarySource).toMatch(/case\s+["']unavailable["']/u);
    expect(summarySource).not.toMatch(/\bReflect\.|\bas\s+FleetEndpoint\["incident"\]/u);
    expect(appSource).toContain("Loading Fleet Health");
    expect(appSource).toContain("Fleet Health is unavailable");
    expect(appSource).not.toContain("Fleet health");
  });
});
