export type SimulatorDemoOutcome =
  "normal" | "abnormal" | "ambiguous" | "no-answer" | "truncated" | "recovery-candidate";

export type SimulatorDemoEvidenceQuality =
  "complete" | "partial" | "unknown" | "invalid" | "not-produced";

export interface SimulatorDemoSourceSpan {
  readonly sourceSpanId: string;
  readonly segmentId: string;
  readonly span: Readonly<{
    start: number;
    end: number;
  }>;
  readonly text: string;
}

export interface SimulatorDemoReading {
  readonly zoneId: string;
  readonly disposition: string;
  readonly value: string | null;
  readonly normalizedUnit: string | null;
  readonly confidence: string | null;
  readonly sourceSpanIds: readonly string[];
}

export interface SimulatorDemoZoneReconciliation {
  readonly zoneId: string;
  readonly disposition: string;
  readonly values: readonly string[];
  readonly sourceSpanIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface SimulatorDemoScenarioProjection {
  readonly scenarioId: string;
  readonly revision: number;
  readonly label: string;
  readonly supportedModes: readonly ("DETERMINISTIC_REPLAY" | "LIVE_SMOKE")[];
  readonly provenance: Readonly<{
    kind: "SIMULATED";
    mode: "DETERMINISTIC_REPLAY";
    compatibility: "simulator-tested";
  }>;
  readonly preRun: Readonly<{
    category: string;
    terminalState: string;
    policyConsequence: string;
    durationMs: number;
  }>;
  readonly sourceEvidence: readonly SimulatorDemoSourceSpan[];
  readonly readings: readonly SimulatorDemoReading[];
  readonly reconciliation: readonly SimulatorDemoZoneReconciliation[];
  readonly observation: Readonly<{
    outcome: SimulatorDemoOutcome;
    quality: SimulatorDemoEvidenceQuality;
    confidence: "High confidence" | "Low confidence" | "Confidence unavailable";
  }>;
  readonly versions: Readonly<{
    adapter: string;
    extractor: string;
  }>;
  readonly dispositions: Readonly<{
    transport: string;
    evidence: string;
    interpretation: string;
    idempotency: string;
  }>;
  readonly recoveryPredecessor: Readonly<{
    scenarioId: string;
    revision: number;
    simulationRunId: string;
  }> | null;
}

export interface SimulatorDemoProjection {
  readonly schemaVersion: "simulator-demo-projection.v1";
  readonly generatedFrom: "canonical deterministic replay";
  readonly scenarios: readonly SimulatorDemoScenarioProjection[];
}
