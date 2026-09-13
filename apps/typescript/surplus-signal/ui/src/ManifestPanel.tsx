import { evidence, type DemoDonor } from "./data.js";
import { AlertIcon, CheckIcon, ClipboardIcon } from "./icons.js";
import type { SimulationPhase } from "./useSimulation.js";

interface ManifestPanelProps {
  donors: readonly DemoDonor[];
  phase: SimulationPhase;
}

export function ManifestPanel({ donors, phase }: ManifestPanelProps) {
  const complete = phase === 3;
  const candidates = donors.filter((donor) => donor.result.pledge !== "pledge withdrawn");
  const withdrawn = donors.find((donor) => donor.result.pledge === "pledge withdrawn");
  return (
    <section className="panel manifest-panel" aria-labelledby="manifest-heading">
      <div className="section-heading">
        <ClipboardIcon />
        <h2 id="manifest-heading">Human review manifest</h2>
      </div>
      <div className={`manifest-content${complete ? " revealed" : ""}`} aria-live="polite">
        <h3>Candidates</h3>
        <div className="manifest-table">
          {complete ? candidates.map((donor) => (
            <div className="manifest-row" key={donor.id}>
              <strong>{donor.name}</strong><span>{donor.result.quantity}</span><span>{donor.result.slot}</span><em>Not scheduled</em>
            </div>
          )) : <div className="manifest-empty" aria-label="No simulated candidates yet" />}
        </div>
        <h3 className="withdrawn-heading">Withdrawn</h3>
        {complete && withdrawn ? <div className="withdrawn-row"><strong>{withdrawn.name}</strong><span>Pledge withdrawn</span></div> : <div className="manifest-empty" aria-label="No simulated withdrawals yet" />}
      </div>
      <div className="evidence-block">
        <h3>Evidence</h3>
        <ul>{evidence.map((item) => <li key={item}><CheckIcon />{item}</li>)}</ul>
      </div>
      <div className="dispatch-warning"><AlertIcon /><strong>Human verification required before dispatch.</strong></div>
    </section>
  );
}
