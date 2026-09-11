import { renderToStaticMarkup } from "react-dom/server";

import { SimulatorScenarioPanel } from "./SimulatorScenarioPanel.js";

export async function renderSimulatorScenarioMarkup(scenarioId: string): Promise<string> {
  return renderToStaticMarkup(
    <SimulatorScenarioPanel initialScenarioId={scenarioId} initialHasResult />,
  );
}
