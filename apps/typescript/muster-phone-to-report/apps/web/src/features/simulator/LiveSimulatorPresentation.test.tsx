import { readFile } from "node:fs/promises";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

interface PresentationModule {
  readonly LiveSimulatorControls: (props: Record<string, unknown>) => React.JSX.Element;
  readonly LiveSimulatorResult: (props: Record<string, unknown>) => React.JSX.Element;
  readonly LiveDemoEvidenceRail: (props: Record<string, unknown>) => React.JSX.Element;
}

async function loadPresentation(): Promise<Partial<PresentationModule>> {
  const controlsUrl = new URL("./LiveSimulatorControls.tsx", import.meta.url).href;
  const resultUrl = new URL("./LiveSimulatorResult.tsx", import.meta.url).href;
  const evidenceRailUrl = new URL("./LiveDemoEvidenceRail.tsx", import.meta.url).href;
  const [controls, result, evidenceRail] = await Promise.all([
    import(/* @vite-ignore */ controlsUrl).catch(() => ({})),
    import(/* @vite-ignore */ resultUrl).catch(() => ({})),
    import(/* @vite-ignore */ evidenceRailUrl).catch(() => ({})),
  ]);
  return { ...controls, ...result, ...evidenceRail } as Partial<PresentationModule>;
}

function completeProjectionForReview() {
  const readings = Array.from({ length: 4 }, (_, index) => ({
    zoneId: `zone-0${String(index + 1)}`,
    label: `Zone ${String(index + 1)}`,
    value: "70",
    unit: "degF",
    status: "OK" as const,
    disposition: "grounded" as const,
  }));
  return {
    operationId: "operation-review-001",
    resourceVersion: 4,
    stage: "terminal" as const,
    terminal: true,
    terminalOutcome: "observation_recorded" as const,
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    provenance: "SIMULATED" as const,
    transcript: [{ speaker: "device" as const, text: "Synthetic four-zone report." }],
    evidence: { quality: "complete" as const, opaqueReference: "custody-ref" },
    readings,
    reconciliation: readings.map(({ zoneId }) => ({
      zoneId,
      disposition: "matched" as const,
    })),
    auxiliaryStatus: {
      sound: "normal" as const,
      power: "mains_available" as const,
      battery: "normal" as const,
      output: "off" as const,
    },
    predecessorOperationId: null,
  };
}

describe("Simulator Lab live controls and result presentation", () => {
  it("renders the exact five-step evidence rail only for a grounded four-reading review", async () => {
    const api = await loadPresentation();
    expect(api.LiveDemoEvidenceRail).toBeTypeOf("function");
    const Rail = api.LiveDemoEvidenceRail;
    if (Rail === undefined) throw new Error("LiveDemoEvidenceRail is unavailable");
    const html = renderToStaticMarkup(
      <Rail
        review={{
          capabilityClosed: true,
          reviewReadyAt: "2026-09-02T12:00:00.000Z",
          reviewExpiresAt: "2026-09-02T12:30:00.000Z",
          cleanupPath: "/api/v1/live-demo-review/sessions/review-session-001",
        }}
        projection={{
          terminalOutcome: "observation_recorded",
          provenance: "SIMULATED",
          evidence: { quality: "complete" },
          transcript: [{ speaker: "device", text: "Synthetic report." }],
          readings: Array.from({ length: 4 }, (_, index) => ({
            zoneId: `zone-0${String(index + 1)}`,
            disposition: "grounded",
          })),
          reconciliation: Array.from({ length: 4 }, (_, index) => ({
            zoneId: `zone-0${String(index + 1)}`,
            disposition: "matched",
          })),
          auxiliaryStatus: {
            sound: "normal",
            power: "mains_available",
            battery: "normal",
            output: "off",
          },
        }}
        cleanup={{ status: "idle", message: null }}
        onFinish={() => {}}
      />,
    );

    const steps = [
      "CALL-E dispatched",
      "Twilio synthetic device answered",
      "transcript admitted",
      "four readings grounded",
      "routing safely restored",
    ];
    expect(html).toContain("External call capability closed—review available for 30 minutes");
    expect(html.match(/data-evidence-step=/gu)).toHaveLength(5);
    for (let index = 1; index < steps.length; index += 1) {
      expect(html.indexOf(steps[index]!)).toBeGreaterThan(html.indexOf(steps[index - 1]!));
    }
    expect(html).toContain('dateTime="2026-09-02T12:30:00.000Z"');
    expect(html).toContain("Finish demo and delete result");
  });

  it("keeps a failed live result honest and offers replay only as a separate opt-in action", async () => {
    const api = await loadPresentation();
    const Result = api.LiveSimulatorResult;
    if (Result === undefined) throw new Error("LiveSimulatorResult is unavailable");
    const html = renderToStaticMarkup(
      <Result
        snapshot={{
          status: "incomplete",
          operationId: "operation-live-failed",
          resourceVersion: 5,
          message: "provider_evidence_invalid_auxiliary_status",
          canRetryStatus: false,
          focusBoundary: "none",
          admittedScenarioId: "synthetic-normal",
          admittedScenarioRevision: 2,
          result: {
            ...completeProjectionForReview(),
            operationId: "operation-live-failed",
            resourceVersion: 5,
            terminalOutcome: "provider_failed",
            transcript: [],
            evidence: null,
            readings: [],
            reconciliation: [],
            auxiliaryStatus: null,
          },
          review: null,
          cleanup: { status: "idle", message: null },
        }}
        onReplay={() => {}}
      />,
    );

    expect(html).toContain("provider_evidence_invalid_auxiliary_status");
    expect(html).not.toContain("Live simulated observation complete");
    expect(html).not.toContain("four readings grounded");
    expect(html).toContain("Replay deterministic fixture (separate from live result)");
  });

  it.each([
    ["deleted", "Protected demo result deleted"],
    ["attention", "Cleanup requires attention"],
  ])("announces the truthful %s cleanup outcome without moving focus", async (status, message) => {
    const api = await loadPresentation();
    const Rail = api.LiveDemoEvidenceRail;
    if (Rail === undefined) throw new Error("LiveDemoEvidenceRail is unavailable");
    const html = renderToStaticMarkup(
      <Rail
        review={{
          capabilityClosed: true,
          reviewReadyAt: "2026-09-02T12:00:00.000Z",
          reviewExpiresAt: "2026-09-02T12:30:00.000Z",
          cleanupPath: "/api/v1/live-demo-review/sessions/review-session-001",
        }}
        projection={completeProjectionForReview()}
        cleanup={{ status, message }}
        onFinish={() => {}}
      />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(message);
    expect(html).not.toContain('autofocus=""');
    expect(html.includes("Finish demo and delete result")).toBe(status !== "deleted");
  });

  it("keeps the review rail linear at narrow widths and visible in reduced-motion and forced-colors modes", async () => {
    const css = await readFile(new URL("../../simulator.css", import.meta.url), "utf8");

    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.live-demo-evidence-rail/gu);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.live-demo-evidence-rail/gu,
    );
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*\.live-demo-evidence-rail/gu);
  });

  it("renders exact authorization commands, a transient masked permit, and replay-only no-answer", async () => {
    const api = await loadPresentation();
    expect(api.LiveSimulatorControls).toBeTypeOf("function");
    const Controls = api.LiveSimulatorControls;
    if (Controls === undefined) throw new Error("LiveSimulatorControls is unavailable");
    const eligible = renderToStaticMarkup(
      <Controls
        enabled={true}
        liveSelected={true}
        scenarioId="synthetic-normal"
        scenarioRevision={2}
        recoveryPredecessorOperationId={null}
        permit=""
        status="idle"
        onModeChange={() => {}}
        onPermitChange={() => {}}
        onRun={() => {}}
      />,
    );
    expect(eligible).toContain("pnpm simulator:authorize --scenario synthetic-normal");
    expect(eligible).toContain('type="password"');
    expect(eligible).toContain('autoComplete="off"');
    expect(eligible).toContain("Run live observation");
    expect(eligible).toContain("SIMULATED");

    const recovery = renderToStaticMarkup(
      <Controls
        enabled={true}
        liveSelected={true}
        scenarioId="synthetic-recovery"
        scenarioRevision={2}
        recoveryPredecessorOperationId="operation-abnormal-001"
        permit=""
        status="idle"
        onModeChange={() => {}}
        onPermitChange={() => {}}
        onRun={() => {}}
      />,
    );
    expect(recovery).toContain(
      "pnpm simulator:authorize --scenario synthetic-recovery --predecessor operation-abnormal-001",
    );

    const noAnswer = renderToStaticMarkup(
      <Controls
        enabled={true}
        liveSelected={false}
        scenarioId="synthetic-no-answer"
        scenarioRevision={2}
        recoveryPredecessorOperationId={null}
        permit=""
        status="idle"
        onModeChange={() => {}}
        onPermitChange={() => {}}
        onRun={() => {}}
      />,
    );
    expect(noAnswer).toContain("replay-only");
    expect(noAnswer).not.toContain("Run live observation");
  });

  it("orders transcript before Reading interpretation with exact complete, incomplete, and recovery headings", async () => {
    const api = await loadPresentation();
    expect(api.LiveSimulatorResult).toBeTypeOf("function");
    const Result = api.LiveSimulatorResult;
    if (Result === undefined) throw new Error("LiveSimulatorResult is unavailable");
    const base = {
      status: "complete",
      operationId: "operation-live-001",
      resourceVersion: 4,
      canRetryStatus: false,
      message: null,
      result: {
        operationId: "operation-live-001",
        resourceVersion: 4,
        stage: "terminal",
        terminal: true,
        scenarioId: "synthetic-normal",
        scenarioRevision: 2,
        provenance: "SIMULATED",
        transcript: [{ speaker: "device", text: "Zone 1 is 71.5 degrees Fahrenheit." }],
        evidence: { quality: "complete", opaqueReference: "custody-ref-001" },
        readings: [
          {
            zoneId: "zone-01",
            label: "North house air temperature",
            value: "71.5",
            unit: "degF",
            disposition: "OK",
          },
        ],
        reconciliation: [{ zoneId: "zone-01", disposition: "matched" }],
        predecessorOperationId: null,
      },
      onRetryStatus: () => {},
    };
    const complete = renderToStaticMarkup(
      <Result
        snapshot={{
          ...base,
          result: { ...base.result, terminalOutcome: "observation_recorded" },
        }}
      />,
    );
    expect(complete).toContain("Live simulated observation complete");
    expect(complete).toContain("operation-live-001");
    expect(complete).toContain("SIMULATED");
    expect(complete.indexOf('data-evidence-role="source-transcript"')).toBeLessThan(
      complete.indexOf('data-evidence-role="derived-readings"'),
    );
    expect(complete).toContain("North house air temperature");

    const incomplete = renderToStaticMarkup(
      <Result
        snapshot={{
          ...base,
          status: "incomplete",
          result: { ...base.result, terminalOutcome: "evidence_incomplete" },
        }}
      />,
    );
    expect(incomplete).toContain(
      "Live simulated observation incomplete—no operational decision made",
    );
    const recovery = renderToStaticMarkup(
      <Result
        snapshot={{
          ...base,
          status: "recovery",
          result: {
            ...base.result,
            terminalOutcome: "recovery_candidate",
            predecessorOperationId: "operation-abnormal-001",
          },
        }}
      />,
    );
    expect(recovery).toContain("Live simulated recovery observed—human confirmation required");
  });
  it("renders all four zone Reading statuses, auxiliary statuses, and the exact simulator-tested ceiling accessibly", async () => {
    const api = await loadPresentation();
    const Result = api.LiveSimulatorResult;
    if (Result === undefined) throw new Error("LiveSimulatorResult is unavailable");
    const readings = [
      ["zone-01", "North house air temperature", "71.5", "degF", "OK"],
      ["zone-02", "Propagation bench temperature", "68.0", "degF", "ALARM"],
      ["zone-03", "Greenhouse relative humidity", "68", "percent", "LOW"],
      ["zone-04", "Irrigation reservoir level", null, null, "UNKNOWN"],
    ].map(([zoneId, label, value, unit, status]) => ({
      zoneId,
      label,
      value,
      unit,
      status,
      disposition: status === "UNKNOWN" ? "ambiguous" : "grounded",
    }));
    const html = renderToStaticMarkup(
      <Result
        snapshot={
          {
            status: "incomplete",
            operationId: "operation-live-001",
            resourceVersion: 5,
            message: "Live observation finished",
            canRetryStatus: false,
            focusBoundary: "terminal",
            admittedScenarioId: "synthetic-normal",
            admittedScenarioRevision: 2,
            result: {
              operationId: "operation-live-001",
              resourceVersion: 5,
              stage: "terminal",
              terminal: true,
              terminalOutcome: "evidence_incomplete",
              scenarioId: "synthetic-normal",
              scenarioRevision: 2,
              provenance: "SIMULATED",
              transcript: [{ speaker: "device", text: "Four-zone report." }],
              evidence: { quality: "partial", opaqueReference: "custody-ref" },
              readings,
              reconciliation: readings.map(({ zoneId }, index) => ({
                zoneId,
                disposition: index === 3 ? "ambiguous" : "matched",
              })),
              auxiliaryStatus: {
                sound: "alarm",
                power: "mains_failed",
                battery: "low",
                output: "on",
              },
              predecessorOperationId: null,
            },
          } as never
        }
      />,
    );

    expect(html.match(/data-reading-zone=/gu)).toHaveLength(4);
    for (const status of ["OK", "ALARM", "LOW", "UNKNOWN"]) {
      expect(html).toContain(`Reading status: ${status}`);
    }
    expect(html).toContain("Sound status");
    expect(html).toContain("Power status");
    expect(html).toContain("Battery status");
    expect(html).toContain("Output status");
    expect(html).toContain("simulator-tested");
    expect(html.indexOf('data-evidence-role="source-transcript"')).toBeLessThan(
      html.indexOf('data-evidence-role="derived-readings"'),
    );
  });
});
