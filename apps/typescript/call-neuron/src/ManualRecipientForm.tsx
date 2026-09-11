import { useState, type FormEvent } from "react";

import type { Recipient } from "./campaign";
import { createManualRecipient, type ManualRecipientInput } from "./imports";

type Props = {
  existingCodes: string[];
  onAdd: (recipient: Recipient) => Promise<void>;
};

type ManualDraft = Omit<ManualRecipientInput, "consentConfirmed">;

const emptyDraft: ManualDraft = {
  studentName: "",
  studentCode: "",
  recipientName: "",
  recipientType: "guardian",
  phone: "",
  employeeCode: "",
  consentSource: "",
  consentTimestamp: "",
};

export function ManualRecipientForm({ existingCodes, onAdd }: Props) {
  const [draft, setDraft] = useState(emptyDraft);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update<Key extends keyof ManualDraft>(key: Key, value: ManualDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onAdd(createManualRecipient({ ...draft, consentConfirmed }, existingCodes));
      setDraft(emptyDraft);
      setConsentConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recipient could not be saved locally.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="manual-entry">
      <summary>Add one recipient manually</summary>
      <form onSubmit={submit}>
        <p className="inline-note">Use the adult who will answer the phone. Required data stays in this browser; only the selected recipient enters CALL-E planning.</p>
        <div className="form-grid">
          <label><span>Student name</span><input value={draft.studentName} maxLength={120} onChange={(event) => update("studentName", event.target.value)} /></label>
          <label><span>Student code</span><input value={draft.studentCode} maxLength={80} onChange={(event) => update("studentCode", event.target.value)} /></label>
          <label><span>Adult recipient name</span><input value={draft.recipientName} maxLength={120} onChange={(event) => update("recipientName", event.target.value)} /></label>
          <label><span>Recipient type</span><select value={draft.recipientType} onChange={(event) => update("recipientType", event.target.value as ManualDraft["recipientType"])}><option value="guardian">Guardian</option><option value="adult_student">Adult student</option></select></label>
          <label><span>Phone · E.164</span><input type="tel" placeholder="+60…" value={draft.phone} maxLength={24} onChange={(event) => update("phone", event.target.value)} /></label>
          <label><span>Employee or owner code</span><input value={draft.employeeCode} maxLength={80} onChange={(event) => update("employeeCode", event.target.value)} /></label>
          <label className="form-grid__wide"><span>Consent evidence source</span><input placeholder="Signed form, portal opt-in, recorded confirmation…" value={draft.consentSource} maxLength={300} onChange={(event) => update("consentSource", event.target.value)} /></label>
          <label><span>Consent recorded at</span><input type="datetime-local" value={draft.consentTimestamp} onChange={(event) => update("consentTimestamp", event.target.value)} /></label>
        </div>
        <label className="danger-confirm danger-confirm--safe"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>I have evidence that this adult agreed to automated scholarship outreach and CALL-E processing/transcription.</span></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--secondary" type="submit" disabled={busy}>{busy ? "Saving locally…" : "Add recipient locally"}</button>
      </form>
    </details>
  );
}
