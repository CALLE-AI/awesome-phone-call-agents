import { useRef, useState } from "react";
import {
  hasSeniorEditErrors,
  initialsFor,
  normalizeSeniorEdit,
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

export function SeniorEditSheet({ senior, onClose, onSave }: SeniorEditSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [edit, setEdit] = useState<SeniorEdit>(() => seniorEditFrom(senior));
  const [errors, setErrors] = useState<SeniorEditErrors>({});
  const [submitted, setSubmitted] = useState(false);

  useModalDialog(sheetRef, closeRef, onClose);

  function patch(field: keyof SeniorEdit, value: string) {
    const next = { ...edit, [field]: value };
    setEdit(next);
    if (submitted) setErrors(validateSeniorEdit(next));
  }

  function submit() {
    const found = validateSeniorEdit(edit);
    setSubmitted(true);
    setErrors(found);
    if (hasSeniorEditErrors(found)) return;
    onSave(normalizeSeniorEdit(edit));
  }

  const preview = normalizeSeniorEdit(edit);
  const fieldProps = (field: keyof SeniorEdit) => ({
    "aria-describedby": errors[field] ? `senior-edit-${field}-error` : undefined,
    "aria-invalid": errors[field] ? true : undefined,
    onChange: (event: { target: { value: string } }) => patch(field, event.target.value),
    value: edit[field],
  });

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
            <SeniorAvatar initials={initialsFor(preview.name) } tone={senior.avatar} size="large" />
            <div>
              <p>Record</p>
              <h3>{preview.preferredName || senior.preferredName}</h3>
              <span>{senior.phoneMasked} · {preview.language || senior.language}</span>
            </div>
          </section>

          <div className="senior-edit-grid">
            <label className="execution-field">
              <span>Full name</span>
              <input autoComplete="off" type="text" {...fieldProps("name")} />
              {errors.name && <small className="field-error" id="senior-edit-name-error" role="alert">{errors.name}</small>}
            </label>
            <label className="execution-field">
              <span>Preferred name</span>
              <input autoComplete="off" type="text" {...fieldProps("preferredName")} />
              <small>CareCall uses this name on the call.</small>
              {errors.preferredName && <small className="field-error" id="senior-edit-preferredName-error" role="alert">{errors.preferredName}</small>}
            </label>
            <label className="execution-field">
              <span>Language</span>
              <input autoComplete="off" type="text" {...fieldProps("language")} />
              <small>Live calling stays blocked for any language other than English until quality is verified.</small>
              {errors.language && <small className="field-error" id="senior-edit-language-error" role="alert">{errors.language}</small>}
            </label>
            <label className="execution-field">
              <span>Permitted call window</span>
              <input autoComplete="off" placeholder="8:00 AM–8:00 PM" type="text" {...fieldProps("callWindow")} />
              <small>Singapore time. Calls outside this window are refused.</small>
              {errors.callWindow && <small className="field-error" id="senior-edit-callWindow-error" role="alert">{errors.callWindow}</small>}
            </label>
            <label className="execution-field">
              <span>Primary caregiver</span>
              <input autoComplete="off" type="text" {...fieldProps("caregiver")} />
              {errors.caregiver && <small className="field-error" id="senior-edit-caregiver-error" role="alert">{errors.caregiver}</small>}
            </label>
            <label className="execution-field">
              <span>Caregiver relationship</span>
              <input autoComplete="off" type="text" {...fieldProps("caregiverRelationship")} />
              {errors.caregiverRelationship && <small className="field-error" id="senior-edit-caregiverRelationship-error" role="alert">{errors.caregiverRelationship}</small>}
            </label>
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
