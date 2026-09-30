import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  OBSERVATION_REVIEWED_ORACLE,
  deployMigrations,
  getPostgresTestConnectionUrls,
} from "@muster/testing";

import {
  createFleetHealthTestRuntime,
  type FleetHealthTestRuntime,
} from "./support/fleet-health-test-runtime.js";

/**
 * Test strategy: exercise the two Phase 5 journeys through generated client, real HTTP,
 * pg-boss worker, and PostgreSQL. The reviewed oracle remains independent of production
 * extraction. Deliberately not tested here: browser semantics (covered by Playwright), real
 * providers/devices, incident creation, production scheduling cadence, or library internals.
 * SIMULATED evidence remains visible in Fleet but is intentionally inert to operational health.
 */

let runtime: FleetHealthTestRuntime | undefined;
let connectionString = "";

beforeEach(async () => {
  connectionString = getPostgresTestConnectionUrls().repository;
  await deployMigrations(connectionString);
});

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
});

describe.sequential("Fleet Health real-boundary journeys", () => {
  it("refreshes Fleet from a complete input-specific observation and its independent oracle", async () => {
    runtime = await createFleetHealthTestRuntime({ connectionString, scenario: "complete" });

    const accepted = await runtime.client.requestObservation({
      endpointId: runtime.endpointId,
      idempotencyKey: "fleet-complete-integration",
      pollWindowId: "fleet-complete-integration-window",
    });
    expect(accepted).toMatchObject({ ok: true, status: 202 });
    if (!accepted.ok) throw new Error("Complete observation was not accepted");

    const terminal = await runtime.waitForTerminal(accepted.data.operationId);
    const oracle = OBSERVATION_REVIEWED_ORACLE[0];
    expect(terminal.observation?.readings.map(({ value }) => value)).toEqual(oracle?.values);
    expect(terminal.observation?.readings.map(({ disposition }) => disposition)).toEqual(
      oracle?.dispositions,
    );
    expect(terminal).toMatchObject({
      terminalOutcome: "observation_recorded",
      observation: { quality: "complete", provenance: "SIMULATED" },
    });

    const fleet = await runtime.client.getFleetHealth();
    expect(fleet).toMatchObject({ ok: true, status: 200 });
    if (!fleet.ok) throw new Error("Fleet projection could not be refreshed");
    expect(fleet.data.endpoints).toHaveLength(1);
    expect(fleet.data.endpoints[0]).toMatchObject({
      endpointId: runtime.endpointId,
      siteDisplayName: "North campus",
      endpointDisplayName: "Boiler room monitor",
      provenance: "SIMULATED",
      operationalState: "not_observed",
      lastAttempt: {
        operationId: accepted.data.operationId,
        terminalOutcome: "observation_recorded",
      },
      lastCompleteObservation: { operationId: accepted.data.operationId, provenance: "SIMULATED" },
      activeManualOperation: null,
      incident: { status: "unavailable" },
    });
  }, 30_000);

  it("publishes provider failure without fabricating health and retains the prior complete observation", async () => {
    runtime = await createFleetHealthTestRuntime({
      connectionString,
      scenario: "provider_failure_after_complete",
    });
    const previousCompleteOperationId = runtime.seededCompleteOperationId;
    expect(previousCompleteOperationId).toBeTruthy();

    const accepted = await runtime.client.requestObservation({
      endpointId: runtime.endpointId,
      idempotencyKey: "fleet-failure-integration",
      pollWindowId: "fleet-failure-integration-window",
    });
    expect(accepted).toMatchObject({ ok: true, status: 202 });
    if (!accepted.ok) throw new Error("Failure observation was not accepted");

    const terminal = await runtime.waitForTerminal(accepted.data.operationId);
    expect(terminal).toMatchObject({
      terminalOutcome: "provider_failed",
      evidence: null,
      observation: null,
      attempt: { provenance: "SIMULATED" },
    });

    const fleet = await runtime.client.getFleetHealth();
    if (!fleet.ok) throw new Error("Fleet projection could not be refreshed");
    expect(fleet.data.endpoints[0]).toMatchObject({
      operationalState: "not_observed",
      lastAttempt: { operationId: accepted.data.operationId, terminalOutcome: "provider_failed" },
      lastCompleteObservation: {
        operationId: previousCompleteOperationId,
        provenance: "SIMULATED",
      },
      activeManualOperation: null,
    });
    expect(fleet.data.endpoints[0]?.lastCompleteObservation?.operationId).not.toBe(
      accepted.data.operationId,
    );
  }, 35_000);

  it.each([
    {
      scenario: "admission_conflict_after_complete",
      status: 409,
      retryAfterSeconds: null,
    },
    {
      scenario: "admission_dependency_unavailable_after_complete",
      status: 503,
      retryAfterSeconds: 1,
    },
  ] as const)(
    "returns safe $status admission failure without fabricating Fleet progress",
    async ({ scenario, status, retryAfterSeconds }) => {
      runtime = await createFleetHealthTestRuntime({ connectionString, scenario });
      const before = await runtime.client.getFleetHealth();
      expect(before).toMatchObject({ ok: true, status: 200 });
      if (!before.ok) throw new Error("Prior Fleet summary could not be read");
      const previousEndpoint = before.data.endpoints[0];
      expect(previousEndpoint?.lastCompleteObservation).not.toBeNull();
      expect(previousEndpoint?.activeManualOperation).toBeNull();

      const rejected = await runtime.client.requestObservation({
        endpointId: runtime.endpointId,
        idempotencyKey: `fleet-${String(status)}-integration`,
        pollWindowId: `fleet-${String(status)}-integration-window`,
      });
      expect(rejected).toMatchObject({
        ok: false,
        status,
        error: { error: { code: status === 409 ? "conflict" : "dependency_unavailable" } },
        headers: { location: null, retryAfterSeconds },
      });

      const after = await runtime.client.getFleetHealth();
      expect(after).toMatchObject({ ok: true, status: 200 });
      if (!after.ok) throw new Error("Fleet summary could not be reconciled after rejection");
      expect(after.data.endpoints[0]).toEqual(previousEndpoint);
      expect(after.data.endpoints[0]).toMatchObject({
        activeManualOperation: null,
        lastAttempt: previousEndpoint?.lastAttempt,
        lastCompleteObservation: previousEndpoint?.lastCompleteObservation,
      });
    },
    30_000,
  );
});
