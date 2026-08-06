import { useRef, useState } from "react";
import {
  callWindowSpansMidnight,
  caregiverRelationshipOptions,
  formatCallWindow,
  hasSeniorEditErrors,
  initialsFor,
  isKnownOption,
  languageOptions,
  normalizeSeniorEdit,
  OTHER_OPTION,
  seniorEditFrom,
  validateSeniorEdit,
  type SeniorEditErrors,
} from "../carecall/senior-directory";
import type { Senior, SeniorEdit } from "../carecall/types";
import { Icon } from "./Icon";
import { SeniorAvatar } from "./CarePrimitives";
import { useModalDialog } from "./useModalDialog";

interface SeniorEditSheetProps {
  senior: Senior;
  onClose: () => void;
  onSave: (edit: SeniorEdit) => void;
}

/** A stored value outside the list is kept as an "Other" remark rather than lost. */
function choiceFor(options: readonly string[], value: string) {
  return isKnownOption(options, value) || !value.trim()
    ? { choice: value.trim(), remark: "" }
    : { choice: OTHER_OPTION, remark: value.trim() };
}

export function SeniorEditSheet({ senior, onClose, onSave }: SeniorEditSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [edit, setEdit] = useState<SeniorEdit>(() => seniorEditFrom(senior));
  const [language, setLanguage] = useState(() => choiceFor(languageOptions, senior.language));
  const [relationship, setRelationship] = useState(() => choiceFor(caregiverRelationshipOptions, senior.caregiverRelationship));
  const [errors, setErrors] = useState<SeniorEditErrors>({});
  const [submitted, setSubmitted] = useState(false);

  useModalDialog(sheetRef, closeRef, onClose);

  function revalidate(next: SeniorEdit) {
    setEdit(next);
    if (submitted) setErrors(validateSeniorEdit(next));
  }

  function patch(field: keyof SeniorEdit, value: string) {
    revalidate({ ...edit, [field]: value });
  }

  function patchLanguage(next: { choice: string; remark: string }) {
    setLanguage(next);
    revalidate({ ...edit, language: next.choice === OTHER_OPTION ? next.remark : next.choice });
  }

  function patchRelationship(next: { choice: string; remark: string }) {
    setRelationship(next);
    revalidate({ ...edit, caregiverRelationship: next.choice === OTHER_OPTION ? next.remark : next.choice });
  }

  function submit() {
    const found = validateSeniorEdit(edit);
    setSubmitted(true);
    setErrors(found);
    if (hasSeniorEditErrors(found)) return;
    onSave(normalizeSeniorEdit(edit));
  }

  const preview = normalizeSeniorEdit(edit);
  const windowLabel = formatCallWindow(preview.callWindowFrom, preview.callWindowTo);
  const overnight = callWindowSpansMidnight(preview.callWindowFrom, preview.callWindowTo);
  const errorId = (field: keyof SeniorEdit) => `senior-edit-${field}-error`;
  const describe = (field: keyof SeniorEdit) => (errors[field] ? { "aria-describedby": errorId(field), "aria-invalid": true as const } : {});

  return (
    <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="senior-edit-title" aria-modal="true" className="call-sheet call-sheet--form" ref={sheetRef} role="dialog">
        <header className="call-sheet__header">
          <div>
            <span className="dry-run-badge"><Icon name="shield" size={14} /> Demo record · no call placed</span>
            <h2 id="senior-edit-title">Edit {senior.preferredName}</h2>
            <p>Changes apply to this demo session and take effect the next time a call is prepared.</p>
          </div>
          <button aria-label="Close senior editor" className="icon-button" onClick={onClose} ref={closeRef} type="button"><Icon name="close" /></button>
        </header>

        <div className="call-sheet__content">
          <section className="preview-recipient">
            <SeniorAvatar initials={initialsFor(preview.name)} tone={senior.avatar} size="large" />
            <div>
              <p>Record</p>
              <h3>{preview.preferredName || senior.preferredName}</h3>
              <span>{senior.phoneMasked} · {preview.language || senior.language}</span>
            </div>
          </section>

          <div className="senior-edit-grid">
            <label className="execution-field">
              <span>Full name</span>
              <input autoComplete="off" onChange={(event) => patch("name", event.target.value)} type="text" value={edit.name} {...describe("name")} />
              {errors.name && <small className="field-error" id={errorId("name")} role="alert">{errors.name}</small>}
            </label>
            <label className="execution-field">
              <span>Preferred name</span>
              <input autoComplete="off" onChange={(event) => patch("preferredName", event.target.value)} type="text" value={edit.preferredName} {...describe("preferredName")} />
              <small>CareCall uses this name on the call.</small>
              {errors.preferredName && <small className="field-error" id={errorId("preferredName")} role="alert">{errors.preferredName}</small>}
            </label>

            <div className="execution-field senior-edit-grid__wide">
              <label className="execution-field">
                <span>Language</span>
                <select onChange={(event) => patchLanguage({ choice: event.target.value, remark: "" })} value={language.choice} {...describe("language")}>
                  {languageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  <option value={OTHER_OPTION}>Other…</option>
                </select>
              </label>
              {language.choice === OTHER_OPTION && (
                <input
                  aria-label="Specify the language"
                  autoComplete="off"
                  onChange={(event) => patchLanguage({ choice: OTHER_OPTION, remark: event.target.value })}
                  placeholder="Which language?"
                  type="text"
                  value={language.remark}
                />
              )}
              <small>Live calling stays blocked for any language other than English until quality is verified.</small>
              {errors.language && <small className="field-error" id={errorId("language")} role="alert">{errors.language}</small>}
            </div>

            <fieldset className="senior-edit-grid__wide call-window-field">
              <legend>Permitted call window</legend>
              <div className="call-window-range">
                <label className="execution-field">
                  <span>From</span>
                  <input onChange={(event) => patch("callWindowFrom", event.target.value)} step={300} type="time" value={edit.callWindowFrom} {...describe("callWindowFrom")} />
                </label>
                <span aria-hidden="true" className="call-window-range__dash">–</span>
                <label className="execution-field">
                  <span>To</span>
                  <input onChange={(event) => patch("callWindowTo", event.target.value)} step={300} type="time" value={edit.callWindowTo} {...describe("callWindowTo")} />
                </label>
              </div>
              <small>
                Singapore time. Calls outside this window are refused.
                {windowLabel && <> Stored as <strong>{windowLabel}</strong>.</>}
              </small>
              {overnight && (
                <small className="call-window-warning" role="status">
                  <Icon name="attention" size={14} /> This window runs past midnight, so CareCall may call overnight.
                </small>
              )}
              {errors.callWindowFrom && <small className="field-error" id={errorId("callWindowFrom")} role="alert">{errors.callWindowFrom}</small>}
              {errors.callWindowTo && <small className="field-error" id={errorId("callWindowTo")} role="alert">{errors.callWindowTo}</small>}
            </fieldset>

            <label className="execution-field">
              <span>Primary caregiver</span>
              <input autoComplete="off" onChange={(event) => patch("caregiver", event.target.value)} type="text" value={edit.caregiver} {...describe("caregiver")} />
              {errors.caregiver && <small className="field-error" id={errorId("caregiver")} role="alert">{errors.caregiver}</small>}
            </label>

            <div className="execution-field">
              <label className="execution-field">
                <span>Caregiver relationship</span>
                <select onChange={(event) => patchRelationship({ choice: event.target.value, remark: "" })} value={relationship.choice} {...describe("caregiverRelationship")}>
                  {caregiverRelationshipOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  <option value={OTHER_OPTION}>Other…</option>
                </select>
              </label>
              {relationship.choice === OTHER_OPTION && (
                <input
                  aria-label="Describe the caregiver relationship"
                  autoComplete="off"
                  onChange={(event) => patchRelationship({ choice: OTHER_OPTION, remark: event.target.value })}
                  placeholder="How are they related?"
                  type="text"
                  value={relationship.remark}
                />
              )}
              {errors.caregiverRelationship && <small className="field-error" id={errorId("caregiverRelationship")} role="alert">{errors.caregiverRelationship}</small>}
            </div>
          </div>

          <section className="boundary-note">
            <Icon name="phone" size={18} />
            <p>
              The phone number is not editable here. This record stores only the masked number {senior.phoneMasked}; the
              full E.164 number is entered by an authorized operator at the moment a call is authorized.
            </p>
          </section>
        </div>

        <footer className="call-sheet__footer">
          <div><Icon name="info" size={17} /><span>Editing a record never places, reschedules, or cancels a call.</span></div>
          <div className="call-sheet__actions">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" onClick={submit} type="button">Save changes</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
