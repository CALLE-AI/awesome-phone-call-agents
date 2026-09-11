import type { DemoDonor } from "./data.js";
import { BoxIcon, CheckIcon, PhoneIcon } from "./icons.js";
import type { SimulationPhase } from "./useSimulation.js";

interface VerificationPanelProps {
  donor: DemoDonor;
  phase: SimulationPhase;
  onRun: () => void;
  onReset: () => void;
}

const disclosure = "I’m calling from SurplusSignal, an AI assistant. CALL-E processes and transcribes this call. May we continue?";

export function VerificationPanel({ donor, phase, onRun, onReset }: VerificationPanelProps) {
  const complete = phase === 3;
  return (
    <section className="panel verification-panel" aria-labelledby="verification-heading">
      <div className="section-heading">
        <PhoneIcon />
        <h2 id="verification-heading">Call verification</h2>
      </div>
      <ol className="steps" aria-live="polite">
        <li className={phase >= 1 ? "active" : ""}>
          <span className="step-index">1</span>
          <div><h3>Disclosure</h3><p>{phase >= 1 ? disclosure : "—"}</p></div>
        </li>
        <li className={phase >= 2 ? "active" : ""}>
          <span className="step-index">2</span>
          <div><h3>Explicit agreement</h3><p>{phase >= 2 ? "Explicit agreement obtained." : "—"}</p></div>
        </li>
        <li className={complete ? "active" : ""}>
          <span className="step-index">3</span>
          <div className="result-step">
            <h3>Structured result</h3>
            {complete ? (
              <dl className="result-list">
                <div><dt><CheckIcon />Result</dt><dd>{donor.result.pledge}</dd></div>
                <div><dt><BoxIcon />Quantity</dt><dd>{donor.result.quantity}</dd></div>
                <div><dt>Pickup window</dt><dd>{donor.result.slot}</dd></div>
                <div><dt>Temperature</dt><dd>{donor.result.storage}</dd></div>
                <div><dt>Packaging</dt><dd>{donor.result.packaging}</dd></div>
              </dl>
            ) : <p>—</p>}
          </div>
        </li>
      </ol>
      <div className="simulation-actions">
        <button className="primary-action" type="button" onClick={onRun}>Run local simulation</button>
        <button className="secondary-action" type="button" onClick={onReset}>Reset</button>
      </div>
    </section>
  );
}
