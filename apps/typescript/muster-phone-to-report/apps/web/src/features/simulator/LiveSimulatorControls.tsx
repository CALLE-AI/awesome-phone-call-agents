import type { LiveSimulatorObservationStatus } from "./useLiveSimulatorObservation.js";
import { SimulationBadge } from "./SimulationBadge.js";

export interface LiveSimulatorControlsProps {
  readonly enabled: boolean;
  readonly eligible?: boolean;
  readonly liveSelected: boolean;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly recoveryPredecessorOperationId: string | null;
  readonly permit: string;
  readonly status: LiveSimulatorObservationStatus;
  readonly onModeChange: (live: boolean) => void;
  readonly onPermitChange: (permit: string) => void;
  readonly onRecoveryPredecessorChange?: (operationId: string) => void;
  readonly onRun: () => void;
}

const opaqueOperationId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isLiveScenarioEligible(input: {
  readonly host: Readonly<{
    enabled: boolean;
    supportedScenarioRevisions: readonly Readonly<{
      scenarioId: string;
      revision: number;
    }>[];
  }> | null;
  readonly scenario: Readonly<{
    scenarioId: string;
    revision: number;
    supportedModes: readonly string[];
  }>;
}): boolean {
  return (
    input.host?.enabled === true &&
    input.scenario.supportedModes.includes("LIVE_SMOKE") &&
    input.host.supportedScenarioRevisions.some(
      (candidate) =>
        candidate.scenarioId === input.scenario.scenarioId &&
        candidate.revision === input.scenario.revision,
    )
  );
}

export function liveAuthorizationCommand(input: {
  readonly scenarioId: string;
  readonly recoveryPredecessorOperationId: string | null;
}): string {
  const base = `pnpm simulator:authorize --scenario ${input.scenarioId}`;
  return input.scenarioId === "synthetic-recovery"
    ? `${base} --predecessor ${input.recoveryPredecessorOperationId ?? "<operationId>"}`
    : base;
}

export function LiveSimulatorControls({
  enabled,
  eligible: eligibleInput,
  liveSelected,
  scenarioId,
  scenarioRevision,
  recoveryPredecessorOperationId,
  permit,
  status,
  onModeChange,
  onPermitChange,
  onRecoveryPredecessorChange,
  onRun,
}: LiveSimulatorControlsProps) {
  const replayOnly = scenarioId === "synthetic-no-answer" || scenarioRevision !== 2;
  const eligible = eligibleInput ?? (enabled && !replayOnly);
  const active = status === "idle" || status === "submission_error";
  const recoveryReady =
    scenarioId !== "synthetic-recovery" ||
    (recoveryPredecessorOperationId !== null &&
      opaqueOperationId.test(recoveryPredecessorOperationId));
  return (
    <>
      <fieldset className="mode-choice" aria-label="Simulator mode">
        <legend>Choose how to run this scenario</legend>
        <label className="choice-row">
          <input
            type="radio"
            name="simulator-mode"
            checked={!liveSelected}
            onChange={() => onModeChange(false)}
          />
          <span>
            <strong>Deterministic replay</strong>
            <small>Offline, repeatable, and safe for judging.</small>
          </span>
        </label>
        {enabled && eligible && !replayOnly ? (
          <label className="choice-row">
            <input
              type="radio"
              name="simulator-mode"
              checked={liveSelected}
              onChange={() => onModeChange(true)}
            />
            <span>
              <strong>Live observation</strong>
              <small>One separately authorized call through the non-production host.</small>
            </span>
          </label>
        ) : null}
      </fieldset>

      {!enabled ? (
        <aside className="live-disabled-note">
          <strong>Live observation is unavailable in this build.</strong> Deterministic replay
          remains available.
        </aside>
      ) : replayOnly ? (
        <aside className="live-disabled-note">
          <strong>This scenario is replay-only.</strong> No-answer cannot initiate a live call;
          deterministic replay remains available.
        </aside>
      ) : !eligible ? (
        <aside className="live-disabled-note">
          <strong>This scenario is unavailable for live observation.</strong> Deterministic replay
          remains available.
        </aside>
      ) : liveSelected ? (
        <section className="live-invocation" aria-label="Live observation authorization">
          <div className="section-heading-row">
            <h3>Authorize one live observation</h3>
            <SimulationBadge />
          </div>
          <p>Mint a fresh one-use permit with this exact command:</p>
          <pre className="authorization-command" aria-disabled={!recoveryReady}>
            <code>{liveAuthorizationCommand({ scenarioId, recoveryPredecessorOperationId })}</code>
          </pre>
          {scenarioId === "synthetic-recovery" ? (
            <label className="permit-field">
              <strong>Recovery predecessor operation ID</strong>
              <input
                type="text"
                autoComplete="off"
                value={recoveryPredecessorOperationId ?? ""}
                onChange={(event) => onRecoveryPredecessorChange?.(event.currentTarget.value)}
              />
              <small>The exact preceding live abnormal operation is required.</small>
            </label>
          ) : null}
          <label className="permit-field">
            <strong>One-use permit</strong>
            <input
              type="password"
              name="live-simulator-permit"
              autoComplete="off"
              spellCheck={false}
              value={permit}
              onChange={(event) => onPermitChange(event.currentTarget.value)}
            />
            <small>The permit stays only in this field and clears after an accepted POST.</small>
          </label>
          <button
            type="button"
            disabled={!active || permit.length === 0 || !recoveryReady}
            onClick={onRun}
          >
            Run live observation
          </button>
        </section>
      ) : null}
    </>
  );
}
