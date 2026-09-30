import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FleetHealthResponse } from "@muster/api-client";
import type { SimulatorLiveProjection } from "@muster/api-client/simulator-live";

import { FleetHealthPage } from "../fleet/FleetHealthPage.js";
import { LiveSimulatorResult } from "./LiveSimulatorResult.js";

const liveResult = Object.freeze({
  operationId: "operation-phase6-visible",
  resourceVersion: 9,
  stage: "terminal",
  terminal: true,
  terminalOutcome: "observation_recorded",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
  provenance: "SIMULATED",
  transcript: Object.freeze([{ speaker: "device", text: "Synthetic report evidence." }]),
  evidence: Object.freeze({ quality: "complete", opaqueReference: "custody://opaque" }),
  readings: Object.freeze([
    Object.freeze({
      zoneId: "zone-01",
      label: "North house air temperature",
      value: "71.5",
      unit: "degF",
      status: "OK",
      disposition: "grounded",
    }),
    Object.freeze({
      zoneId: "zone-02",
      label: "Propagation bench temperature",
      value: "68.0",
      unit: "degF",
      status: "OK",
      disposition: "grounded",
    }),
    Object.freeze({
      zoneId: "zone-03",
      label: "Greenhouse relative humidity",
      value: "68",
      unit: "percent",
      status: "OK",
      disposition: "grounded",
    }),
    Object.freeze({
      zoneId: "zone-04",
      label: "Irrigation reservoir level",
      value: "82",
      unit: "percent",
      status: "OK",
      disposition: "grounded",
    }),
  ]),
  reconciliation: Object.freeze([
    Object.freeze({ zoneId: "zone-01", disposition: "matched" }),
    Object.freeze({ zoneId: "zone-02", disposition: "matched" }),
    Object.freeze({ zoneId: "zone-03", disposition: "matched" }),
    Object.freeze({ zoneId: "zone-04", disposition: "matched" }),
  ]),
  auxiliaryStatus: Object.freeze({
    sound: "normal",
    power: "mains_available",
    battery: "normal",
    output: "off",
  }),
  predecessorOperationId: null,
  dtmfActions: 0,
  twilioReconciliation: "1 matching call",
}) as unknown as SimulatorLiveProjection;

describe("Phase 6 terminal provenance presentation", () => {
  it("AC-HAPPY-7 and AC-HAPPY-11 expose exact Simulator Lab terminal evidence accessibly", () => {
    const markup = renderToStaticMarkup(
      <LiveSimulatorResult
        snapshot={{
          status: "complete",
          operationId: liveResult.operationId,
          resourceVersion: liveResult.resourceVersion,
          message: "Live observation finished",
          canRetryStatus: false,
          focusBoundary: "terminal",
          result: liveResult,
          admittedScenarioId: liveResult.scenarioId,
          admittedScenarioRevision: liveResult.scenarioRevision,
        }}
      />,
    );
    expect(markup).toContain("Live simulated observation complete");
    expect(markup).toContain("SIMULATED");
    expect(markup).toContain("Operation ID");
    expect(markup).toContain("Terminal status");
    expect(markup).toContain("DTMF actions");
    expect(markup).toContain("0");
    expect(markup).toContain("Twilio reconciliation");
    expect(markup).toContain("1 matching call");
    expect(markup.indexOf("Source transcript")).toBeLessThan(markup.indexOf("Derived Readings"));
  });

  it("AC-HAPPY-7 exposes the same SIMULATED operation and terminal status in Fleet", () => {
    const fleet = Object.freeze({
      contractVersion: "1",
      generatedAt: "2026-08-24T20:01:00.000Z",
      schedulerHeartbeat: Object.freeze({
        status: "missing",
        observedAt: null,
        checkOutcome: null,
        evidenceKind: "foundation_health_job_completion",
      }),
      endpoints: Object.freeze([
        Object.freeze({
          endpointId: "greenhouse-synthetic",
          siteDisplayName: "Hackathon lab",
          endpointDisplayName: "Synthetic greenhouse",
          provenance: "SIMULATED",
          operationalState: "not_observed",
          freshness: Object.freeze({ status: "not_observed", observedAt: null }),
          lastAttempt: Object.freeze({
            operationId: liveResult.operationId,
            resourceVersion: 9,
            trigger: "manual",
            provenance: "SIMULATED",
            acceptedAt: "2026-08-24T20:00:00.000Z",
            lastTransitionAt: "2026-08-24T20:00:07.000Z",
            stage: "terminal",
            terminalOutcome: "observation_recorded",
            retryable: false,
            observationQuality: "complete",
          }),
          lastCompleteObservation: null,
          activeManualOperation: null,
          incident: Object.freeze({ status: "unavailable" }),
        }),
      ]),
    }) as FleetHealthResponse;
    const markup = renderToStaticMarkup(<FleetHealthPage fleet={fleet} />);
    expect(markup).toContain("SIMULATED");
    expect(markup).toContain("Operation ID");
    expect(markup).toContain(liveResult.operationId);
    expect(markup).toContain("Terminal status");
    expect(markup).not.toContain("No open incident");
  });
});
