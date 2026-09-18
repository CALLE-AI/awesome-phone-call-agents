import { type SimulatorScenario, validateSimulatorScenario } from "@muster/contracts";

function scenarioKey(scenarioId: string, revision: number): string {
  return JSON.stringify([scenarioId, revision]);
}

export class SimulatorScenarioCatalog {
  private readonly scenarios: readonly SimulatorScenario[];
  private readonly byReference: ReadonlyMap<string, SimulatorScenario>;

  public constructor(values: readonly unknown[]) {
    const scenarios = values
      .map(validateSimulatorScenario)
      .sort(
        (left, right) =>
          left.scenarioId.localeCompare(right.scenarioId) || left.revision - right.revision,
      );
    const byReference = new Map<string, SimulatorScenario>();
    for (const scenario of scenarios) {
      const key = scenarioKey(scenario.scenarioId, scenario.revision);
      if (byReference.has(key)) {
        throw new Error(
          `Duplicate simulator scenario: ${scenario.scenarioId}@${String(scenario.revision)}`,
        );
      }
      byReference.set(key, scenario);
    }
    this.scenarios = Object.freeze(scenarios);
    this.byReference = byReference;
  }

  public list(): readonly SimulatorScenario[] {
    return this.scenarios;
  }

  public get(scenarioId: string, revision: number): SimulatorScenario {
    const scenario = this.byReference.get(scenarioKey(scenarioId, revision));
    if (scenario === undefined) {
      throw new Error(`Unknown simulator scenario: ${scenarioId}@${String(revision)}`);
    }
    return scenario;
  }
}
