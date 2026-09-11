import { useState } from "react";
import { AppHeader } from "./AppHeader.js";
import { donors } from "./data.js";
import { DrivePanel } from "./DrivePanel.js";
import { ManifestPanel } from "./ManifestPanel.js";
import { useSimulation } from "./useSimulation.js";
import { VerificationPanel } from "./VerificationPanel.js";

export function App() {
  const [selectedId, setSelectedId] = useState(donors[0].id);
  const { phase, run, reset } = useSimulation();
  const selectedDonor = donors.find((donor) => donor.id === selectedId) ?? donors[0];
  return (
    <div className="app-shell">
      <AppHeader />
      <main className="dashboard">
        <DrivePanel donors={donors} selectedId={selectedId} onSelect={setSelectedId} />
        <VerificationPanel donor={selectedDonor} phase={phase} onRun={run} onReset={reset} />
        <ManifestPanel donors={donors} phase={phase} />
      </main>
    </div>
  );
}
