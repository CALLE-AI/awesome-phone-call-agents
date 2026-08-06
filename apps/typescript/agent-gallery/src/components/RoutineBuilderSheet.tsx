import { useRef, useState } from "react";
import { conversationPlanFor, routineKindOrder, routineKindProfile } from "../carecall/routine-kinds";
import {
  emptyRoutineDraft,
  hasRoutineDraftErrors,
  normalizeRoutineDraft,
  routineFrequencyLabels,
  scheduleLabel,
  trustFirstOpening,
  validateRoutineDraft,
  type RoutineDraft,
  type RoutineDraftErrors,
  type RoutineFrequency,
} from "../carecall/routine-directory";
import type { Senior } from "../carecall/types";
import { Icon } from "./Icon";
import { RoutineIcon, SeniorAvatar } from "./CarePrimitives";
import { useModalDialog } from "./useModalDialog";

interface RoutineBuilderSheetProps {
  seniors: Senior[];
  initialSeniorId: string;
  onClose: () => void;
  onCreate: (draft: RoutineDraft, senior: Senior | undefined) => void;
}

export function RoutineBuilderSheet({ seniors, initialSeniorId, onClose, onCreate }: RoutineBuilderSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const selectable = seniors.filter((senior) => senior.status === "active");
  const [draft, setDraft] = useState<RoutineDraft>(
    () => emptyRoutineDraft(selectable.some((senior) => senior.id === initialSeniorId) ? initialSeniorId : selectable[0]?.id ?? ""),
  );
  const [errors, setErrors] = useState<RoutineDraftErrors>({});
  const [submitted, setSubmitted] = useState(false);

  useModalDialog(sheetRef, closeRef, onClose);

  const senior = seniors.find((candidate) => candidate.id === draft.seniorId);
  const profile = routineKindProfile(draft.kind);
  const preferredName = senior?.preferredName ?? "the senior";
  const caregiver = senior?.caregiver ?? "the caregiver";
  const plan = conversationPlanFor(draft.kind, preferredName, caregiver);
  const normalized = normalizeRoutineDraft(draft);

  function patch(next: Partial<RoutineDraft>) {
    const updated = { ...draft, ...next };
    setDraft(updated);
    if (submitted) setErrors(validateRoutineDraft(updated, seniors.find((candidate) => candidate.id === updated.seniorId)));
  }

  function submit() {
    const found = validateRoutineDraft(draft, senior);
    setSubmitted(true);
    setErrors(found);
    if (hasRoutineDraftErrors(found)) return;
    onCreate(normalizeRoutineDraft(draft), senior);
  }

  const errorId = (field: keyof RoutineDraft) => `routine-builder-${field}-error`;
  const describe = (field: keyof RoutineDraft) => (errors[field] ? { "aria-describedby": errorId(field), "aria-invalid": true as const } : {});

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="routine-builder-title" aria-modal="true" className="call-sheet call-sheet--form" ref={sheetRef} role="dialog">
        <header className="call-sheet__header">
          <div>
            <span className="dry-run-badge"><Icon name="shield" size={14} /> Draft routine · no call placed</span>
            <h2 id="routine-builder-title">New care routine</h2>
            <p>A routine describes a call. It stays paused until someone authorizes a schedule or a single call.</p>
          </div>
          <button aria-label="Close routine builder" className="icon-button" onClick={onClose} ref={closeRef} type="button"><Icon name="close" /></button>
        </header>

        <div className="call-sheet__content">
          {selectable.length === 0 ? (
            <div className="calls-empty">
              <Icon name="users" size={26} />
              <h3>No senior is in active care</h3>
              <p>Restore a senior to active care before writing a routine for them.</p>
            </div>
          ) : (
            <>
              <fieldset className="routine-kind-field">
                <legend>What kind of call is this?</legend>
                <div className="routine-kind-grid">
                  {routineKindOrder.map((kind) => {
                    const option = routineKindProfile(kind);
                    return (
                      <label className="routine-kind-option" data-selected={draft.kind === kind} key={kind}>
                        <input
                          checked={draft.kind === kind}
                          name="routine-kind"
                          onChange={() => patch({ kind })}
                          type="radio"
                          value={kind}
                        />
                        <RoutineIcon kind={kind} />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.purpose}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="senior-edit-grid">
                <label className="execution-field">
                  <span>Senior</span>
                  <select onChange={(event) => patch({ seniorId: event.target.value })} value={draft.seniorId} {...describe("seniorId")}>
                    {selectable.map((option) => <option key={option.id} value={option.id}>{option.preferredName}</option>)}
                  </select>
                  {senior && <small>Permitted call window {senior.callWindow} · {senior.language}</small>}
                  {errors.seniorId && <small className="field-error" id={errorId("seniorId")} role="alert">{errors.seniorId}</small>}
                </label>
                <label className="execution-field">
                  <span>Routine name</span>
                  <input autoComplete="off" onChange={(event) => patch({ title: event.target.value })} placeholder={profile.callLabel} type="text" value={draft.title} {...describe("title")} />
                  <small>Shown in the call console and in call history.</small>
                  {errors.title && <small className="field-error" id={errorId("title")} role="alert">{errors.title}</small>}
                </label>

                <label className="execution-field senior-edit-grid__wide">
                  <span>{profile.instructionLabel}</span>
                  <textarea onChange={(event) => patch({ caregiverInstruction: event.target.value })} placeholder={profile.instructionPlaceholder} rows={2} value={draft.caregiverInstruction} {...describe("caregiverInstruction")} />
                  <small>This wording reaches the call. The agent repeats it and does not improvise around it.</small>
                  {errors.caregiverInstruction && <small className="field-error" id={errorId("caregiverInstruction")} role="alert">{errors.caregiverInstruction}</small>}
                </label>

                <label className="execution-field senior-edit-grid__wide">
                  <span>Trust phrase</span>
                  <input autoComplete="off" onChange={(event) => patch({ trustPhrase: event.target.value })} placeholder={profile.trustPhrasePlaceholder} type="text" value={draft.trustPhrase} {...describe("trustPhrase")} />
                  <small>Names the person who asked for the call, so it does not sound like a scam.</small>
                  {errors.trustPhrase && <small className="field-error" id={errorId("trustPhrase")} role="alert">{errors.trustPhrase}</small>}
                </label>

                <label className="execution-field">
                  <span>Frequency</span>
                  <select onChange={(event) => patch({ frequency: event.target.value as RoutineFrequency })} value={draft.frequency}>
                    {Object.entries(routineFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="execution-field">
                  <span>Singapore time</span>
                  <input onChange={(event) => patch({ timeSgt: event.target.value })} step={300} type="time" value={draft.timeSgt} {...describe("timeSgt")} />
                  <small>{scheduleLabel(draft.frequency, draft.timeSgt)}</small>
                  {errors.timeSgt && <small className="field-error" id={errorId("timeSgt")} role="alert">{errors.timeSgt}</small>}
                </label>
              </div>

              <section className="preview-block">
                <p className="preview-label"><Icon name="phone" size={16} /> Trust-first opening</p>
                <blockquote>“{trustFirstOpening(preferredName, normalized.trustPhrase)}”</blockquote>
              </section>

              <section className="preview-block">
                <p className="preview-label"><Icon name="routine" size={16} /> Conversation plan</p>
                <ol className="conversation-plan">
                  {plan.map((step, index) => (
                    <li key={step.title}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{index === 1 ? (normalized.caregiverInstruction || profile.instructionPlaceholder) : step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="plan-source"><Icon name="info" size={15} /> The plan follows the call kind, so this preview always matches what the agent is instructed to do.</p>
              </section>

              <section className="boundary-note">
                <Icon name="shield" size={18} />
                <p>{profile.boundary}</p>
              </section>

              <section className="future-note">
                <span className="future-note__mark" aria-hidden="true"><Icon name="sparkle" size={17} /></span>
                <div>
                  <strong>Planned enhancement · not implemented</strong>
                  <p>
                    The opening and conversation plan are written by hand today. A later pass could draft both from the
                    senior's care record, past call outcomes, and an organisation's approved phrasing library, retrieved
                    with RAG and composed through an AI API, so an operator reviews and approves a proposed plan instead of
                    composing one from scratch.
                  </p>
                  <p>
                    Any such draft would stay a suggestion. The caregiver-approved wording, the routine kind's fixed
                    boundary, and the separate authorization step would still gate every call, and no generated plan would
                    reach a senior without a person approving it.
                  </p>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="call-sheet__footer">
          <div><Icon name="info" size={17} /><span>Creating a routine never places a call or activates a schedule.</span></div>
          <div className="call-sheet__actions">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" disabled={selectable.length === 0} onClick={submit} type="button">Create routine</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
