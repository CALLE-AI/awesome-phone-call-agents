import { useRef } from "react";
import { conversationPlanFor, routineKindProfile } from "../carecall/routine-kinds";
import { seniorIsCallable } from "../carecall/senior-directory";
import type { CareRoutine, Senior } from "../carecall/types";
import { Icon } from "./Icon";
import { RoutineIcon, SeniorAvatar } from "./CarePrimitives";
import { useModalDialog } from "./useModalDialog";

export function CallPreviewSheet({ routine, senior, onClose, onAuthorize, onActivate }: { routine: CareRoutine; senior: Senior; onClose: () => void; onAuthorize: () => void; onActivate: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  useModalDialog(sheetRef, closeRef, onClose);

  const profile = routineKindProfile(routine.kind);
  const plan = conversationPlanFor(routine.kind, senior.preferredName, senior.caregiver);
  const languageVerified = senior.language === "English";
  const callable = seniorIsCallable(senior);

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="preview-title" aria-modal="true" className="call-sheet" ref={sheetRef} role="dialog">
        <header className="call-sheet__header">
          <div>
            <span className="dry-run-badge"><Icon name="shield" size={14} /> Dry run · no call placed</span>
            <h2 id="preview-title">Preview {routine.title.toLowerCase()}</h2>
            <p>Review exactly what CareCall will do before authorization.</p>
          </div>
          <button aria-label="Close call preview" className="icon-button" onClick={onClose} ref={closeRef} type="button"><Icon name="close" /></button>
        </header>

        <div className="call-sheet__content">
          <section className="preview-recipient">
            <SeniorAvatar initials={senior.initials} tone={senior.avatar} size="large" />
            <div>
              <p>Calling</p>
              <h3>{senior.preferredName}</h3>
              <span>{senior.phoneMasked} · {senior.language}</span>
            </div>
            <RoutineIcon kind={routine.kind} />
          </section>

          <section className="preview-block">
            <p className="preview-label"><Icon name="phone" size={16} /> Trust-first opening</p>
            <blockquote>“Hello {senior.preferredName}. I’m CareCall, an automated calling assistant. {routine.trustPhrase} I will never ask for money, an OTP, or bank information.”</blockquote>
          </section>

          <section className="preview-block">
            <p className="preview-label"><Icon name="routine" size={16} /> Conversation plan</p>
            <ol className="conversation-plan">
              {plan.map((step, index) => (
                <li key={step.title}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{index === 1 ? routine.caregiverInstruction : step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="preview-block preview-block--boundary">
            <p className="preview-label"><Icon name="shield" size={16} /> {profile.callLabel} boundary</p>
            <p className="preview-boundary">{profile.boundary}</p>
          </section>

          <div className="preview-policy-grid">
            <section className="policy-panel" data-kind="may">
              <h3><Icon name="check" size={17} /> The agent will</h3>
              <ul>
                <li>Use one question at a time.</li>
                <li>Repeat the caregiver-approved wording.</li>
                <li>Record answers as self-reported.</li>
                <li>Offer a human callback.</li>
              </ul>
            </section>
            <section className="policy-panel" data-kind="never">
              <h3><Icon name="close" size={17} /> The agent will never</h3>
              <ul>
                <li>Give dosage or missed-dose advice.</li>
                <li>Treat silence as completion.</li>
                <li>Ask for money, OTPs, or bank details.</li>
                <li>Claim emergency help was dispatched.</li>
              </ul>
            </section>
          </div>
        </div>

        <footer className="call-sheet__footer">
          <div>
            <Icon name="info" size={17} />
            <span>
              {!callable
                ? `${senior.preferredName} is withdrawn from care calls. This preview is read-only.`
                : languageVerified
                  ? "A real call requires a separate one-call authorization."
                  : `${senior.language} calling is not enabled until language quality is verified.`}
            </span>
          </div>
          <div className="call-sheet__actions">
            <button className="secondary-button" onClick={onClose} type="button">Close preview</button>
            <button className="secondary-button" disabled={!languageVerified || !callable} onClick={onActivate} type="button">Activate schedule</button>
            <button className="primary-button" disabled={!languageVerified || !callable} onClick={onAuthorize} type="button">Authorize one call</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
