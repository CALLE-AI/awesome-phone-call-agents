import { useEffect, useMemo, useRef, useState } from "react";

import type {
  SimulatorDemoProjection,
  SimulatorDemoScenarioProjection,
} from "@muster/api-client/simulator-demo";
import type {
  SimulatorLiveAvailability,
  SimulatorLiveClient,
} from "@muster/api-client/simulator-live";
import { createSimulatorLiveClient } from "@muster/api-client/simulator-live";

import generatedProjection from "../../generated/simulator-demo-projection.json";
import { isLiveScenarioEligible, LiveSimulatorControls } from "./LiveSimulatorControls.js";
import { LiveSimulatorResult } from "./LiveSimulatorResult.js";
import { SimulationBadge } from "./SimulationBadge.js";
import {
  type LiveSimulatorOperationIdentity,
  useLiveSimulatorObservation,
} from "./useLiveSimulatorObservation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSimulatorDemoProjection(value: unknown): value is SimulatorDemoProjection {
  if (!isRecord(value) || value["schemaVersion"] !== "simulator-demo-projection.v1") return false;
  const scenarios = value["scenarios"];
  return (
    Array.isArray(scenarios) &&
    scenarios.length > 0 &&
    scenarios.every((scenario) => {
      if (!isRecord(scenario) || !isRecord(scenario["provenance"])) return false;
      const provenance = scenario["provenance"];
      return (
        typeof scenario["scenarioId"] === "string" &&
        Array.isArray(scenario["supportedModes"]) &&
        provenance["kind"] === "SIMULATED" &&
        provenance["mode"] === "DETERMINISTIC_REPLAY" &&
        provenance["compatibility"] === "simulator-tested" &&
        Array.isArray(scenario["sourceEvidence"]) &&
        Array.isArray(scenario["readings"]) &&
        Array.isArray(scenario["reconciliation"])
      );
    })
  );
}

if (!isSimulatorDemoProjection(generatedProjection)) {
  throw new Error("Generated simulator demo projection is invalid or lacks SIMULATED provenance");
}

const simulatorProjection: SimulatorDemoProjection = generatedProjection;
const scenarios = simulatorProjection.scenarios;
const LIVE_OPERATION_STORAGE_KEY = "muster.simulator.live-operation-id";
const LIVE_DEMO_REVIEW_EXPECTED_KEY = "muster.simulator.live-demo-review-expected";
const opaqueIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface LiveOperationIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const unavailableLiveClient: SimulatorLiveClient = {
  getAvailability: async () => ({
    ok: false,
    status: "transport_error",
    error: null,
    headers: { location: null, retryAfterSeconds: null },
  }),
  requestLiveObservation: async () => ({
    ok: false,
    status: "transport_error",
    error: null,
    headers: { location: null, retryAfterSeconds: null },
  }),
  getLiveObservation: async () => ({
    ok: false,
    status: "transport_error",
    error: null,
    headers: { location: null, retryAfterSeconds: null },
  }),
  finishLiveDemoReview: async () => ({
    ok: false,
    status: "transport_error",
    error: null,
    headers: { location: null, retryAfterSeconds: null },
  }),
};

function browserLiveClient(): SimulatorLiveClient | null {
  if (typeof globalThis.location === "undefined") return null;
  return createSimulatorLiveClient({ baseUrl: globalThis.location.origin });
}

export function readLiveOperationIdentity(
  storage: LiveOperationIdentityStorage,
): LiveSimulatorOperationIdentity | null {
  try {
    const serialized = storage.getItem(LIVE_OPERATION_STORAGE_KEY);
    if (serialized === null) return null;
    const value = JSON.parse(serialized) as unknown;
    if (!isRecord(value)) return null;
    const keys = Object.keys(value);
    if (
      keys.length !== 3 ||
      !keys.includes("operationId") ||
      !keys.includes("scenarioId") ||
      !keys.includes("scenarioRevision") ||
      typeof value["operationId"] !== "string" ||
      !opaqueIdentifier.test(value["operationId"]) ||
      typeof value["scenarioId"] !== "string" ||
      !opaqueIdentifier.test(value["scenarioId"]) ||
      !Number.isSafeInteger(value["scenarioRevision"]) ||
      Number(value["scenarioRevision"]) < 1 ||
      Number(value["scenarioRevision"]) > 100
    ) {
      return null;
    }
    return Object.freeze({
      operationId: value["operationId"],
      scenarioId: value["scenarioId"],
      scenarioRevision: Number(value["scenarioRevision"]),
    });
  } catch {
    return null;
  }
}

export function writeLiveOperationIdentity(
  storage: LiveOperationIdentityStorage,
  identity: LiveSimulatorOperationIdentity | null,
): void {
  try {
    if (identity === null) storage.removeItem(LIVE_OPERATION_STORAGE_KEY);
    else storage.setItem(LIVE_OPERATION_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Recovery storage is optional; server authority and GET-only behavior are unchanged.
  }
}

export function captureLiveDemoBrowserHandoff(input: {
  readonly hash: string;
  readonly cleanAddress: string;
  readonly storage: LiveOperationIdentityStorage;
  readonly replaceAddressBar: (cleanAddress: string) => void;
}): LiveSimulatorOperationIdentity | null {
  if (input.hash.length === 0) return readLiveOperationIdentity(input.storage);
  let identity: LiveSimulatorOperationIdentity | null = null;
  try {
    const parameters = new URLSearchParams(input.hash.startsWith("#") ? input.hash.slice(1) : "");
    const keys = [...parameters.keys()];
    const operationId = parameters.get("operationId");
    const scenarioId = parameters.get("scenarioId");
    const scenarioRevision = parameters.get("scenarioRevision");
    if (
      keys.length === 3 &&
      new Set(keys).size === 3 &&
      keys.includes("operationId") &&
      keys.includes("scenarioId") &&
      keys.includes("scenarioRevision") &&
      operationId !== null &&
      opaqueIdentifier.test(operationId) &&
      scenarioId !== null &&
      opaqueIdentifier.test(scenarioId) &&
      scenarioRevision !== null &&
      /^[1-9][0-9]?$|^100$/u.test(scenarioRevision)
    ) {
      identity = Object.freeze({
        operationId,
        scenarioId,
        scenarioRevision: Number(scenarioRevision),
      });
      writeLiveOperationIdentity(input.storage, identity);
    } else {
      writeLiveOperationIdentity(input.storage, null);
    }
  } catch {
    writeLiveOperationIdentity(input.storage, null);
  } finally {
    input.replaceAddressBar(input.cleanAddress);
  }
  return identity;
}

function storedLiveOperationIdentity(): LiveSimulatorOperationIdentity | null {
  try {
    if (globalThis.sessionStorage === undefined) return null;
    if (typeof globalThis.location !== "undefined" && globalThis.location.hash.length > 0) {
      const identity = captureLiveDemoBrowserHandoff({
        hash: globalThis.location.hash,
        cleanAddress: `${globalThis.location.pathname}${globalThis.location.search}`,
        storage: globalThis.sessionStorage,
        replaceAddressBar: (cleanAddress) =>
          globalThis.history.replaceState(globalThis.history.state, "", cleanAddress),
      });
      if (identity === null) globalThis.sessionStorage.removeItem(LIVE_DEMO_REVIEW_EXPECTED_KEY);
      else globalThis.sessionStorage.setItem(LIVE_DEMO_REVIEW_EXPECTED_KEY, "true");
      return identity;
    }
    return readLiveOperationIdentity(globalThis.sessionStorage);
  } catch {
    return null;
  }
}

function storedLiveDemoReviewExpected(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(LIVE_DEMO_REVIEW_EXPECTED_KEY) === "true";
  } catch {
    return false;
  }
}

function storeLiveOperationIdentity(identity: LiveSimulatorOperationIdentity | null): void {
  try {
    if (globalThis.sessionStorage !== undefined) {
      writeLiveOperationIdentity(globalThis.sessionStorage, identity);
      globalThis.sessionStorage.removeItem(LIVE_DEMO_REVIEW_EXPECTED_KEY);
    }
  } catch {
    // Recovery storage is optional; server authority and GET-only behavior are unchanged.
  }
}

function outcomeHeading(scenario: SimulatorDemoScenarioProjection): string {
  switch (scenario.observation.outcome) {
    case "normal":
      return "Observation complete";
    case "abnormal":
      return "Threshold exceeded";
    case "ambiguous":
    case "truncated":
      return "Observation incomplete—no operational decision made";
    case "no-answer":
      return "No answer received";
    case "recovery-candidate":
      return "Recovery observed—human confirmation required";
  }
}

function displayZone(zoneId: string): string {
  const match = /^zone-0*([1-9][0-9]*)$/u.exec(zoneId);
  return match?.[1] === undefined ? zoneId : `Zone ${match[1]}`;
}

function evidenceFinding(scenario: SimulatorDemoScenarioProjection): string {
  const contradictory = scenario.reconciliation.find(
    ({ disposition }) => disposition === "contradictory",
  );
  if (contradictory !== undefined) {
    return `${displayZone(contradictory.zoneId)} has contradictory values. Low confidence.`;
  }
  const missing = scenario.reconciliation.find(({ disposition }) => disposition === "missing");
  if (missing !== undefined) {
    return `${displayZone(missing.zoneId)} is missing. ${scenario.observation.confidence}.`;
  }
  switch (scenario.observation.outcome) {
    case "normal":
      return "Complete evidence; no qualifying threshold event.";
    case "abnormal":
      return "Grounded readings exceeded the configured threshold.";
    case "recovery-candidate":
      return "Complete later evidence is linked to the preceding simulated anomaly.";
    case "ambiguous":
    case "truncated":
      return "Evidence is incomplete—no operational decision made.";
    case "no-answer":
      return "No answer received; no device evidence was produced.";
  }
}

function runSteps(scenario: SimulatorDemoScenarioProjection): readonly string[] {
  return [
    "Request recorded",
    `Transport ${scenario.dispositions.transport.replaceAll("_", " ")}`,
    scenario.dispositions.evidence === "persisted" ? "Evidence persisted" : "Evidence not produced",
    scenario.dispositions.interpretation === "recorded"
      ? "Interpretation recorded"
      : "Interpretation not run",
  ];
}

function isFailureOutcome(scenario: SimulatorDemoScenarioProjection): boolean {
  return ["ambiguous", "truncated", "no-answer"].includes(scenario.observation.outcome);
}

interface ScenarioResultProps {
  readonly scenario: SimulatorDemoScenarioProjection;
  readonly runNumber: number;
  readonly focusHeading?: boolean;
}

function ScenarioResult({ scenario, runNumber, focusHeading = false }: ScenarioResultProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading, scenario.scenarioId, runNumber]);
  const announcement = isFailureOutcome(scenario)
    ? `${outcomeHeading(scenario)}. No operational decision. ${runSteps(scenario).join(". ")}.`
    : `Replay recorded. ${runSteps(scenario).join(". ")}.`;

  return (
    <div className="simulator-result-layout">
      <div
        className="visually-hidden"
        role={isFailureOutcome(scenario) ? "alert" : "status"}
        aria-live={isFailureOutcome(scenario) ? "assertive" : "polite"}
      >
        {announcement}
      </div>

      <section className="simulator-card simulator-card--status" aria-label="Run status">
        <h2>Run status</h2>
        <ol className="run-status-list">
          {runSteps(scenario).map((step, index, steps) => (
            <li key={step} aria-current={index === steps.length - 1 ? "step" : undefined}>
              <span aria-hidden="true">{index === steps.length - 1 ? "◆" : "✓"}</span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section
        className="simulator-card simulator-card--evidence"
        aria-label="Evidence"
        data-evidence-role="source"
      >
        <div className="section-heading-row">
          <h2>Source evidence</h2>
          <SimulationBadge />
        </div>
        <p>Canonical source evidence is shown before every derived interpretation.</p>
        {scenario.sourceEvidence.length === 0 ? (
          <p className="evidence-empty">No synthetic report evidence was produced.</p>
        ) : (
          <ol className="source-evidence-list">
            {scenario.sourceEvidence.map((source) => (
              <li key={source.sourceSpanId}>
                <p>
                  <strong>{source.segmentId}</strong> · Source span {source.span.start}–
                  {source.span.end}
                </p>
                <blockquote>{source.text}</blockquote>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="simulator-card simulator-card--result"
        aria-label="Result"
        data-evidence-role="interpretation"
      >
        <SimulationBadge />
        <h2 ref={headingRef} tabIndex={-1}>
          {outcomeHeading(scenario)}
        </h2>
        <p>{evidenceFinding(scenario)}</p>

        <h3>Derived readings</h3>
        {scenario.readings.length === 0 ? (
          <p>No derived readings were created.</p>
        ) : (
          <ul>
            {scenario.readings.map((reading) => (
              <li key={reading.zoneId}>
                {displayZone(reading.zoneId)}: {reading.value ?? reading.disposition}
                {reading.normalizedUnit === null ? "" : ` ${reading.normalizedUnit}`} —{" "}
                {reading.disposition}
              </li>
            ))}
          </ul>
        )}

        <h3>Expected-zone reconciliation</h3>
        <ul>
          {scenario.reconciliation.map((zone) => (
            <li key={zone.zoneId}>
              {displayZone(zone.zoneId)}: {zone.disposition}
              {zone.values.length === 0 ? "" : ` (${zone.values.join(", ")})`}
            </li>
          ))}
        </ul>

        <dl className="result-metadata">
          <div>
            <dt>Fixture</dt>
            <dd>{scenario.scenarioId}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{scenario.revision}</dd>
          </div>
          <div>
            <dt>Run reference</dt>
            <dd>SIM-DEMO-{String(runNumber).padStart(4, "0")}</dd>
          </div>
          <div>
            <dt>Compatibility</dt>
            <dd>{scenario.provenance.compatibility}</dd>
          </div>
          <div>
            <dt>Evidence quality</dt>
            <dd>{scenario.observation.quality}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{scenario.observation.confidence}</dd>
          </div>
          <div>
            <dt>Adapter version</dt>
            <dd>{scenario.versions.adapter}</dd>
          </div>
          <div>
            <dt>Extractor version</dt>
            <dd>{scenario.versions.extractor}</dd>
          </div>
          {scenario.recoveryPredecessor === null ? null : (
            <div>
              <dt>Recovery predecessor</dt>
              <dd>
                {scenario.recoveryPredecessor.scenarioId}@{scenario.recoveryPredecessor.revision}
              </dd>
            </div>
          )}
        </dl>
        <p className="interpretation-limit">
          This synthetic simulator result does not prove physical hardware behavior or native-alarm
          coexistence.
        </p>
      </section>
    </div>
  );
}

function UnknownScenarioResult({ scenarioId }: { readonly scenarioId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [scenarioId]);
  return (
    <section className="simulator-card simulator-card--unknown" aria-label="Result" role="alert">
      <p className="provenance-unavailable">Provenance unavailable</p>
      <h2 ref={headingRef} tabIndex={-1}>
        Unrecognized result—no operational decision made
      </h2>
      <p>Cannot safely start this simulated run. The requested scenario is not in the catalog.</p>
      <p>
        Requested identifier: <code>{scenarioId}</code>
      </p>
    </section>
  );
}

export interface SimulatorScenarioPanelProps {
  readonly initialScenarioId?: string;
  readonly initialHasResult?: boolean;
  readonly liveClient?: SimulatorLiveClient | null;
}

export function SimulatorScenarioPanel({
  initialScenarioId,
  initialHasResult = false,
  liveClient,
}: SimulatorScenarioPanelProps) {
  const defaultScenario = scenarios[0];
  if (defaultScenario === undefined) throw new Error("Simulator demo projection has no scenarios");
  const [resumeOperation, setResumeOperation] = useState(storedLiveOperationIdentity);
  const [awaitReviewMetadata] = useState(storedLiveDemoReviewExpected);
  const resumedScenario =
    resumeOperation === null
      ? undefined
      : scenarios.find(
          ({ scenarioId, revision }) =>
            scenarioId === resumeOperation.scenarioId &&
            revision === resumeOperation.scenarioRevision,
        );
  const requestedScenario =
    resumedScenario ??
    (initialScenarioId === undefined
      ? defaultScenario
      : scenarios.find(({ scenarioId }) => scenarioId === initialScenarioId));
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    requestedScenario?.scenarioId ?? defaultScenario.scenarioId,
  );
  const [resultScenarioId, setResultScenarioId] = useState<string | null>(
    initialHasResult ? (initialScenarioId ?? defaultScenario.scenarioId) : null,
  );
  const [runNumber, setRunNumber] = useState(initialHasResult ? 1 : 0);
  const resolvedLiveClient = useMemo(
    () => (liveClient === undefined ? browserLiveClient() : liveClient),
    [liveClient],
  );
  const [liveAvailability, setLiveAvailability] = useState<SimulatorLiveAvailability | null>(null);
  const [liveSelected, setLiveSelected] = useState(resumeOperation !== null);
  const [permit, setPermit] = useState("");
  const [recoveryPredecessorOperationId, setRecoveryPredecessorOperationId] = useState<
    string | null
  >(null);
  const selectedScenario =
    scenarios.find(({ scenarioId }) => scenarioId === selectedScenarioId) ?? defaultScenario;
  const liveEligible = isLiveScenarioEligible({
    host: liveAvailability,
    scenario: selectedScenario,
  });
  const resultScenario = scenarios.find(({ scenarioId }) => scenarioId === resultScenarioId);
  useEffect(() => {
    let active = true;
    if (resolvedLiveClient === null)
      return () => {
        active = false;
      };
    void resolvedLiveClient.getAvailability().then((result) => {
      if (active && result.ok && result.data.enabled) setLiveAvailability(result.data);
    });
    return () => {
      active = false;
    };
  }, [resolvedLiveClient]);
  const live = useLiveSimulatorObservation({
    scenarioId: selectedScenario.scenarioId,
    scenarioRevision: selectedScenario.revision,
    client: resolvedLiveClient ?? unavailableLiveClient,
    resumeOperation,
    awaitReviewMetadata,
    onPermitAccepted: () => setPermit(""),
    onOperationEstablished: storeLiveOperationIdentity,
    onReviewDeleted: () => {
      setResumeOperation(null);
      storeLiveOperationIdentity(null);
    },
  });

  function replaySelectedScenario(): void {
    setRunNumber((current) => current + 1);
    setResultScenarioId(selectedScenario.scenarioId);
  }

  function selectScenario(nextScenario: SimulatorDemoScenarioProjection): void {
    const persistedOperation = resumeOperation ?? storedLiveOperationIdentity();
    if (
      persistedOperation !== null &&
      (persistedOperation.scenarioId !== nextScenario.scenarioId ||
        persistedOperation.scenarioRevision !== nextScenario.revision)
    ) {
      setResumeOperation(null);
      storeLiveOperationIdentity(null);
    }
    setSelectedScenarioId(nextScenario.scenarioId);
  }

  return (
    <>
      <header className="simulator-hero">
        <div>
          <p className="eyebrow">Demo and development composition</p>
          <h1>Simulator Lab</h1>
          <p>Replay committed synthetic phone fixtures through an evidence-first operator view.</p>
        </div>
        <SimulationBadge />
      </header>

      <aside className="simulation-disclosure" aria-label="Simulation limitation">
        {liveAvailability === null ? (
          <strong>No external call will be placed.</strong>
        ) : (
          <strong>A live call occurs only after explicit one-use authorization.</strong>
        )}{" "}
        Deterministic replay is the reliable default. Results are synthetic evidence, never hardware
        proof.
      </aside>

      <div className="simulator-controls">
        <section className="simulator-card" aria-label="Mode">
          <h2>Mode</h2>
          <LiveSimulatorControls
            enabled={liveAvailability?.enabled === true}
            eligible={liveEligible}
            liveSelected={liveSelected}
            scenarioId={selectedScenario.scenarioId}
            scenarioRevision={selectedScenario.revision}
            recoveryPredecessorOperationId={recoveryPredecessorOperationId}
            permit={permit}
            status={live.snapshot.status}
            onModeChange={setLiveSelected}
            onPermitChange={setPermit}
            onRecoveryPredecessorChange={(operationId) =>
              setRecoveryPredecessorOperationId(operationId === "" ? null : operationId)
            }
            onRun={() => void live.run(permit)}
          />
        </section>

        <section className="simulator-card" aria-labelledby="scenarios-heading">
          <h2 id="scenarios-heading">Scenarios</h2>
          <fieldset className="scenario-grid">
            <legend>Choose a committed fixture</legend>
            {scenarios.map((scenario) => {
              const disclosureId = `${scenario.scenarioId}-scenario-disclosure`;
              return (
                <label className="scenario-choice" key={scenario.scenarioId}>
                  <input
                    type="radio"
                    name="scenario"
                    value={scenario.scenarioId}
                    checked={scenario.scenarioId === selectedScenario.scenarioId}
                    aria-describedby={disclosureId}
                    onChange={() => selectScenario(scenario)}
                  />
                  <span id={disclosureId} className="scenario-disclosure">
                    <span className="scenario-choice-heading">
                      <strong>{scenario.label}</strong>
                      <SimulationBadge />
                    </span>
                    <small>Category: {scenario.preRun.category}</small>
                    <small>Terminal state: {scenario.preRun.terminalState}</small>
                    <small>Policy consequence: {scenario.preRun.policyConsequence}</small>
                    <small>Recorded duration: {scenario.preRun.durationMs} ms</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="run-action">
            <p>
              Selected fixture: <code>{selectedScenario.scenarioId}</code> revision{" "}
              {selectedScenario.revision}
            </p>
            <button type="button" onClick={replaySelectedScenario}>
              Replay simulated scenario
            </button>
          </div>
        </section>
      </div>

      {resultScenarioId === null ? (
        <section className="simulator-ready simulator-card" aria-label="Run status">
          <h2>Ready to replay</h2>
          <p>Select a fixture and replay it. No network or provider transport is used.</p>
        </section>
      ) : resultScenario === undefined ? (
        <UnknownScenarioResult scenarioId={resultScenarioId} />
      ) : (
        <ScenarioResult scenario={resultScenario} runNumber={runNumber} focusHeading />
      )}
      {liveSelected ? (
        <LiveSimulatorResult
          snapshot={live.snapshot}
          onRetryStatus={() => void live.retryStatus()}
          onFinishReview={() => void live.finishReview()}
          onReplay={replaySelectedScenario}
        />
      ) : null}
    </>
  );
}
