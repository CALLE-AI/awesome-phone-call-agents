import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

interface ControlsModule {
  readonly LiveSimulatorControls: (props: Record<string, unknown>) => React.JSX.Element;
  readonly isLiveScenarioEligible: (input: Record<string, unknown>) => boolean;
}

async function loadControls(): Promise<Partial<ControlsModule>> {
  return (await import("./LiveSimulatorControls.js")) as unknown as Partial<ControlsModule>;
}

const callbacks = {
  onModeChange: () => undefined,
  onPermitChange: () => undefined,
  onRun: () => undefined,
};

describe("live observation eligibility and exact presentation", () => {
  it("requires host enabled, an exact supported scenario revision, and catalog LIVE_SMOKE support", async () => {
    const api = await loadControls();
    expect(api.isLiveScenarioEligible).toBeTypeOf("function");
    const base = {
      host: {
        enabled: true,
        runtimeProfile: "development",
        supportedScenarioRevisions: [{ scenarioId: "synthetic-normal", revision: 2 }],
      },
      scenario: {
        scenarioId: "synthetic-normal",
        revision: 2,
        supportedModes: ["DETERMINISTIC_REPLAY", "LIVE_SMOKE"],
      },
    };

    expect(api.isLiveScenarioEligible?.(base)).toBe(true);
    expect(api.isLiveScenarioEligible?.({ ...base, host: { ...base.host, enabled: false } })).toBe(
      false,
    );
    expect(
      api.isLiveScenarioEligible?.({
        ...base,
        host: {
          ...base.host,
          supportedScenarioRevisions: [{ scenarioId: "synthetic-normal", revision: 1 }],
        },
      }),
    ).toBe(false);
    expect(
      api.isLiveScenarioEligible?.({
        ...base,
        scenario: { ...base.scenario, supportedModes: ["DETERMINISTIC_REPLAY"] },
      }),
    ).toBe(false);
  });

  it("renders disabled and ineligible states as live observation without the legacy smoke label", async () => {
    const api = await loadControls();
    const Controls = api.LiveSimulatorControls;
    if (Controls === undefined) throw new Error("controls unavailable");
    const disabled = renderToStaticMarkup(
      <Controls
        enabled={false}
        eligible={false}
        liveSelected={false}
        scenarioId="synthetic-normal"
        scenarioRevision={2}
        recoveryPredecessorOperationId={null}
        permit=""
        status="idle"
        {...callbacks}
      />,
    );
    const ineligible = renderToStaticMarkup(
      <Controls
        enabled={true}
        eligible={false}
        liveSelected={false}
        scenarioId="synthetic-normal"
        scenarioRevision={2}
        recoveryPredecessorOperationId={null}
        permit=""
        status="idle"
        {...callbacks}
      />,
    );

    expect(disabled).toContain("Live observation is unavailable in this build.");
    expect(ineligible).toContain("This scenario is unavailable for live observation.");
    expect(`${disabled}${ineligible}`).not.toMatch(/Live smoke/iu);
    expect(`${disabled}${ineligible}`).not.toContain("Run live observation");
  });
});
