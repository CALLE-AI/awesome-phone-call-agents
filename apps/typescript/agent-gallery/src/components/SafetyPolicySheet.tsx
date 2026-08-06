import { useRef } from "react";
import {
  safetyPolicyEmergency,
  safetyPolicyEscalation,
  safetyPolicyFlags,
  safetyPolicyKinds,
  safetyPolicyMay,
  safetyPolicyNever,
  safetyPolicyUrgencies,
} from "../carecall/safety-policy";
import type { RoutineKind } from "../carecall/types";
import { Icon } from "./Icon";
import { RoutineIcon } from "./CarePrimitives";
import { useModalDialog } from "./useModalDialog";

export function SafetyPolicySheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  useModalDialog(sheetRef, closeRef, onClose);

  const kinds = safetyPolicyKinds();

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="safety-policy-title" aria-modal="true" className="call-sheet call-sheet--form" ref={sheetRef} role="dialog">
        <header className="call-sheet__header">
          <div>
            <span className="dry-run-badge"><Icon name="shield" size={14} /> Enforced in the call workflow</span>
            <h2 id="safety-policy-title">CareCall safety policy</h2>
            <p>CareCall reminds, records what a senior says, and hands anything uncertain to a person.</p>
          </div>
          <button aria-label="Close safety policy" className="icon-button" onClick={onClose} ref={closeRef} type="button"><Icon name="close" /></button>
        </header>

        <div className="call-sheet__content">
          <section className="policy-alert" role="note">
            <Icon name="attention" size={19} />
            <p>{safetyPolicyEmergency}</p>
          </section>

          <div className="preview-policy-grid">
            <section className="policy-panel" data-kind="may">
              <h3><Icon name="check" size={17} /> CareCall may</h3>
              <ul>{safetyPolicyMay.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </section>
            <section className="policy-panel" data-kind="never">
              <h3><Icon name="close" size={17} /> CareCall never</h3>
              <ul>{safetyPolicyNever.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </section>
          </div>

          <section className="preview-block">
            <p className="preview-label"><Icon name="routine" size={16} /> Boundary for each kind of call</p>
            <div className="policy-kinds">
              {kinds.map((entry) => (
                <article className="policy-kind" key={entry.kind}>
                  <header>
                    <RoutineIcon kind={entry.kind as RoutineKind} />
                    <strong>{entry.callLabel}</strong>
                  </header>
                  <p>{entry.boundary}</p>
                  <details>
                    <summary>{entry.outcomes.length} outcomes this call may report</summary>
                    <ul className="policy-outcome-list">
                      {entry.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}
                    </ul>
                  </details>
                </article>
              ))}
            </div>
            <p className="plan-source">
              <Icon name="info" size={15} />
              A call of one kind cannot report another kind's outcome. Anything outside its list is recorded as uncertain and sent for review.
            </p>
          </section>

          <section className="preview-block">
            <p className="preview-label"><Icon name="attention" size={16} /> Review flags raised on a call</p>
            <div className="policy-flags">
              {safetyPolicyFlags.map((flag) => (
                <article className="policy-flag" key={flag.flag}>
                  <strong>{flag.label}</strong>
                  <p>{flag.meaning}</p>
                  <p className="policy-flag__response"><Icon name="chevron" size={14} /> {flag.response}</p>
                </article>
              ))}
            </div>
            <p className="plan-source">
              <Icon name="info" size={15} />
              A flag says wording appeared in the call. It does not establish who said it or that it is true, and any flag other than possible immediate danger forces the outcome to uncertain.
            </p>
          </section>

          <section className="preview-block">
            <p className="preview-label"><Icon name="clock" size={16} /> What each urgency level asks of a person</p>
            <dl className="policy-urgency">
              {safetyPolicyUrgencies.map((level) => (
                <div key={level.urgency}>
                  <dt>{level.label}</dt>
                  <dd>{level.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="preview-block">
            <p className="preview-label"><Icon name="shield" size={16} /> Standing limits</p>
            <ul className="policy-limits">
              {safetyPolicyEscalation.map((rule) => <li key={rule}><Icon name="check" size={15} /> {rule}</li>)}
            </ul>
          </section>
        </div>

        <footer className="call-sheet__footer">
          <div><Icon name="info" size={17} /><span>These rules are applied by the call workflow, not only described here.</span></div>
          <div className="call-sheet__actions">
            <button className="primary-button" onClick={onClose} type="button">Close</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
