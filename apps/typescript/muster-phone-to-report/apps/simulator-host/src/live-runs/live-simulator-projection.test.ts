import { describe, expect, it } from "vitest";

import { projectLiveSimulatorOperation } from "./live-simulator-projection.js";

function authorization() {
  return {
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    predecessorOperationId: null,
  } as never;
}

function resultFreeOperation(terminalOutcome: string | null, terminal = true) {
  return {
    contractVersion: "1",
    operationId: "operation-projection",
    resourceVersion: 4,
    stage: terminal ? "terminal" : "calling",
    terminal,
    lastTransitionAt: "2026-09-09T12:00:00.000Z",
    latestRevisionAt: null,
    attempt: {
      trigger: "manual",
      provenance: "SIMULATED",
      acceptedAt: "2026-09-09T11:59:00.000Z",
      retryable: false,
    },
    terminalOutcome,
    evidence: null,
    observation: null,
    recommendedAction: "none",
  } as never;
}

describe("live simulator projection", () => {
  it.each(["blocked", "no_answer", "busy", "provider_failed", "evidence_unavailable"])(
    "preserves the durable result-free %s terminal outcome",
    (terminalOutcome) => {
      expect(
        projectLiveSimulatorOperation({
          operation: resultFreeOperation(terminalOutcome),
          authorization: authorization(),
          evidenceRecord: undefined,
          admission: undefined,
        }),
      ).toMatchObject({
        terminal: true,
        terminalOutcome,
        evidence: null,
        readings: [],
      });
    },
  );

  it("fails closed as evidence unavailable when observation_recorded lacks its durable result", () => {
    expect(
      projectLiveSimulatorOperation({
        operation: resultFreeOperation("observation_recorded"),
        authorization: authorization(),
        evidenceRecord: undefined,
        admission: undefined,
      }),
    ).toMatchObject({
      terminal: true,
      terminalOutcome: "evidence_unavailable",
      evidence: null,
      readings: [],
    });
  });

  it("keeps nonterminal projections result-free without inventing an outcome", () => {
    expect(
      projectLiveSimulatorOperation({
        operation: resultFreeOperation(null, false),
        authorization: authorization(),
        evidenceRecord: undefined,
        admission: undefined,
      }),
    ).toMatchObject({ terminal: false, terminalOutcome: null });
  });
});
