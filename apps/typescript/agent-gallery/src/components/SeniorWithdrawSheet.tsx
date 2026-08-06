import { useRef, useState } from "react";
import type { WithdrawalImpact } from "../carecall/senior-directory";
import type { Senior } from "../carecall/types";
import { Icon } from "./Icon";
import { SeniorAvatar } from "./CarePrimitives";
import { useModalDialog } from "./useModalDialog";

interface SeniorWithdrawSheetProps {
  senior: Senior;
  impact: WithdrawalImpact;
  onClose: () => void;
  onWithdraw: () => void;
}

export function SeniorWithdrawSheet({ senior, impact, onClose, onWithdraw }: SeniorWithdrawSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [confirmed, setConfirmed] = useState(false);

  useModalDialog(sheetRef, closeRef, onClose);

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="senior-withdraw-title" aria-modal="true" className="call-sheet call-sheet--form" ref={sheetRef} role="dialog">
        <header className="call-sheet__header">
          <div>
            <span className="dry-run-badge" data-tone="attention"><Icon name="attention" size={14} /> Stops all future calls</span>
            <h2 id="senior-withdraw-title">Withdraw {senior.preferredName} from care calls</h2>
            <p>The record stays visible so past calls and care cases keep their subject.</p>
          </div>
          <button aria-label="Close withdrawal confirmation" className="icon-button" onClick={onClose} ref={closeRef} type="button"><Icon name="close" /></button>
        </header>

        <div className="call-sheet__content">
          <section className="preview-recipient">
            <SeniorAvatar initials={senior.initials} tone={senior.avatar} size="large" />
            <div>
              <p>Withdrawing</p>
              <h3>{senior.name}</h3>
              <span>{senior.phoneMasked} · {senior.caregiver} · {senior.caregiverRelationship}</span>
            </div>
          </section>

          <div className="preview-policy-grid">
            <section className="policy-panel" data-kind="never">
              <h3><Icon name="close" size={17} /> What stops</h3>
              <ul>
                <li>
                  {impact.routineCount === 1
                    ? "1 care routine stops being scheduled."
                    : `${impact.routineCount} care routines stop being scheduled.`}
                </li>
                <li>No new call can be authorized for this senior.</li>
                <li>Any queued occurrence is invalidated and needs fresh authority.</li>
              </ul>
            </section>
            <section className="policy-panel" data-kind="may">
              <h3><Icon name="check" size={17} /> What is kept</h3>
              <ul>
                <li>Completed call history and its recorded outcomes.</li>
                <li>
                  {impact.openCaseCount === 1
                    ? "1 open care case remains for a human to close."
                    : `${impact.openCaseCount} open care cases remain for a human to close.`}
                </li>
                <li>The record can be restored to active care later.</li>
              </ul>
            </section>
          </div>

          {impact.routineCount > 0 && (
            <section className="preview-block">
              <p className="preview-label"><Icon name="routine" size={16} /> Routines that will stop</p>
              <ul className="withdraw-routine-list">
                {impact.routineTitles.map((title) => <li key={title}><Icon name="clock" size={15} /> {title}</li>)}
              </ul>
            </section>
          )}

          <label className="authorization-check">
            <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
            <span>
              I confirm the care team has agreed to stop CareCall reminders for {senior.preferredName}, and that
              {" "}{senior.caregiver} has been informed.
            </span>
          </label>

          <section className="boundary-note">
            <Icon name="shield" size={18} />
            <p>
              A call the provider has already accepted cannot be recalled. If a call is in progress, let it finish and
              follow the provider's termination process rather than relying on this action.
            </p>
          </section>
        </div>

        <footer className="call-sheet__footer">
          <div><Icon name="info" size={17} /><span>Withdrawal applies to this demo session only.</span></div>
          <div className="call-sheet__actions">
            <button className="secondary-button" onClick={onClose} type="button">Keep in care</button>
            <button className="primary-button primary-button--attention" disabled={!confirmed} onClick={onWithdraw} type="button">
              Withdraw from care
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
