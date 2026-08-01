import { useEffect, useMemo, useRef, useState } from "react";

import { LiveCallPanel } from "./LiveCallPanel";
import { ManualRecipientForm } from "./ManualRecipientForm";
import {
  buildCampaignCsv,
  campaignMetrics,
  maskPhone,
  type CampaignResult,
  type Disposition,
  type Recipient,
} from "./campaign";
import { importShortlist } from "./imports";
import { type CallEConnection, type CallRun, type OfferBrief } from "./live";
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from "./persistence";

const stages = ["Offer", "Recipients", "Consent", "Call", "Follow-up"] as const;
const attestations = [
  "I confirmed the named adult or guardian.",
  "The evidence covers scholarship or education-support outreach.",
  "The evidence covers an automated voice call.",
  "The evidence covers CALL-E processing and transcription.",
];
const defaultOffer: OfferBrief = {
  organization: "",
  offer: "",
  details: "",
  callbackPhone: "",
  escalation: "eligibility, awards, finances, documents, complaints, safeguarding, and anything outside the approved brief",
};

const dispositionLabels: Record<Disposition, string> = {
  unreviewed: "Unreviewed",
  interested: "Interested — human follow-up",
  needs_information: "Needs information",
  not_interested: "Not interested",
  opted_out: "Opted out — do not call",
  unreachable: "Unreachable",
};

function downloadCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "call-neuron-results.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function voicemailCopy(offer: OfferBrief) {
  return `Hello. This is an automated assistant calling for ${offer.organization}. Please call us back at ${offer.callbackPhone}. Thank you.`;
}

export function App() {
  const [stage, setStage] = useState(0);
  const [furthestStage, setFurthestStage] = useState(0);
  const [offer, setOffer] = useState(defaultOffer);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [sourceName, setSourceName] = useState("No recipients loaded");
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [checkedAttestations, setCheckedAttestations] = useState<boolean[]>(attestations.map(() => false));
  const [voicemail, setVoicemail] = useState(false);
  const [connection, setConnection] = useState<CallEConnection | null>(null);
  const [runs, setRuns] = useState<Record<string, CallRun>>({});
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({});
  const [resetArmed, setResetArmed] = useState(false);
  const [message, setMessage] = useState("Operator workspace ready. Complete the approved offer brief; no call is planned.");
  const stagePanelRef = useRef<HTMLElement>(null);
  const previousStage = useRef(stage);

  const eligibleRecipients = useMemo(() => recipients.filter((recipient) => recipient.status === "eligible"), [recipients]);
  const availableRecipients = useMemo(() => eligibleRecipients.filter((recipient) => !runs[recipient.id]), [eligibleRecipients, runs]);
  const selectedRecipient = eligibleRecipients.find((recipient) => recipient.id === selectedRecipientId) || availableRecipients[0];
  const results = useMemo<CampaignResult[]>(() => Object.entries(runs).map(([recipientId, run]) => ({
    recipientId,
    providerSignal: run.status.toLowerCase(),
    summary: run.summary,
    transcript: run.transcript,
    attemptedAt: run.attemptedAt,
  })), [runs]);
  const metrics = useMemo(() => campaignMetrics(results, dispositions), [results, dispositions]);
  const offerValid = Object.values(offer).every((value) => value.trim()) && /^\+[1-9]\d{7,14}$/u.test(offer.callbackPhone);
  const campaignReady = offerValid && availableRecipients.length > 0;

  useEffect(() => {
    loadLocalDraft().then((draft) => {
      if (!draft?.recipients.length) return;
      setRecipients(draft.recipients);
      setOffer(draft.offer || defaultOffer);
      setSourceName(draft.sourceName);
      setDispositions(draft.dispositions || {});
      setSelectedRecipientId(draft.recipients.find((item) => item.status === "eligible")?.id || "");
      setMessage(`Local campaign restored from ${draft.sourceName}. CALL-E access and live transcripts were not stored.`);
    }).catch(() => setMessage("Local draft storage is unavailable; this tab can still place a controlled call."));
  }, []);

  useEffect(() => {
    if (previousStage.current !== stage) {
      stagePanelRef.current?.focus({ preventScroll: true });
      previousStage.current = stage;
    }
  }, [stage]);

  function advance(nextStage: number, status: string) {
    setStage(nextStage);
    setFurthestStage((current) => Math.max(current, nextStage));
    setMessage(status);
  }

  async function persist(nextRecipients = recipients, nextDispositions = dispositions, nextOffer = offer, nextSource = sourceName) {
    await saveLocalDraft({ sourceName: nextSource, recipients: nextRecipients, offer: nextOffer, dispositions: nextDispositions, savedAt: new Date().toISOString() });
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setImportBusy(true);
    setImportError("");
    setImportWarnings([]);
    try {
      const result = await importShortlist(file);
      const firstEligible = result.recipients.find((recipient) => recipient.status === "eligible");
      setRecipients(result.recipients);
      setSourceName(result.sourceName);
      setImportWarnings(result.warnings);
      setSelectedRecipientId(firstEligible?.id || "");
      setRuns({});
      setDispositions({});
      setCheckedAttestations(attestations.map(() => false));
      await persist(result.recipients, {}, offer, result.sourceName);
      setMessage(`${result.recipients.length} valid records loaded locally from ${result.sourceName}; ${result.warnings.length} rejected.`);
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : "The shortlist could not be imported.");
    } finally {
      setImportBusy(false);
    }
  }

  async function addManualRecipient(recipient: Recipient) {
    const next = [...recipients, recipient];
    const nextSource = sourceName === "No recipients loaded" ? "Manual entries" : sourceName;
    setRecipients(next);
    setSourceName(nextSource);
    setSelectedRecipientId(recipient.id);
    await persist(next, dispositions, offer, nextSource);
    setMessage(`${recipient.studentCode} was added locally. No data entered CALL-E and no call was created.`);
  }

  function selectRecipient(recipientId: string) {
    setSelectedRecipientId(recipientId);
    setCheckedAttestations(attestations.map(() => false));
  }

  async function resetCampaign() {
    setStage(0);
    setFurthestStage(0);
    setOffer(defaultOffer);
    setRecipients([]);
    setSourceName("No recipients loaded");
    setSelectedRecipientId("");
    setImportError("");
    setImportWarnings([]);
    setCheckedAttestations(attestations.map(() => false));
    setVoicemail(false);
    setConnection(null);
    setRuns({});
    setDispositions({});
    setResetArmed(false);
    await clearLocalDraft().catch(() => undefined);
    setMessage("Local campaign deleted from this browser. Provider-side CALL-E records, if any, are not changed.");
  }

  async function changeDisposition(recipientId: string, disposition: Disposition) {
    const next = { ...dispositions, [recipientId]: disposition };
    setDispositions(next);
    await persist(recipients, next, offer).catch(() => setMessage("Disposition updated in this tab, but local draft saving failed."));
  }

  function updateRun(recipientId: string, run: CallRun) {
    setRuns((current) => ({ ...current, [recipientId]: run }));
  }

  function callAnotherRecipient() {
    const next = availableRecipients.find((recipient) => recipient.id !== selectedRecipientId) || availableRecipients[0];
    setSelectedRecipientId(next?.id || "");
    setCheckedAttestations(attestations.map(() => false));
    setVoicemail(false);
    advance(1, next ? "Choose the next consent-ready recipient. Your CALL-E connection remains available in this tab." : "No unattempted consent-ready recipient remains.");
  }

  return (
    <>
      <a className="skip-link" href="#workspace">Skip to operator workspace</a>
      <div className="atmosphere" aria-hidden="true"><span className="atmosphere__glow atmosphere__glow--one" /><span className="atmosphere__glow atmosphere__glow--two" /><span className="atmosphere__arc atmosphere__arc--one" /><span className="atmosphere__arc atmosphere__arc--two" /></div>
      <div className="app-frame">
        <header className="site-header">
          <a className="brand" href="/" aria-label="CallNeuron home"><img className="brand__mark" src="/callneuron-logo.png" alt="" width="31" height="31" /><span>CallNeuron</span></a>
          <span className="mode-label mode-label--live"><span aria-hidden="true">●</span>Operator prototype · real calls</span>
        </header>

        <main id="workspace" className="shell">
          <section className="workspace-heading" aria-labelledby="page-title">
            <div><p className="eyebrow">Consent-first scholarship outreach</p><h1 id="page-title">Call with care. <em>Hand off to a human.</em></h1></div>
            <div className="workspace-heading__proof">
              <p>Prepare one approved opportunity, contact one consented adult, and turn the outcome into a clear human follow-up.</p>
              <div className="proof-strip" aria-label="Product safeguards"><span>Identity first</span><span>One call at a time</span><span>No automatic retry</span></div>
              <a className="button button--primary hero-action" href="#campaign-stages">Set up a real campaign <span aria-hidden="true">→</span></a>
            </div>
          </section>

          <section className="operator-guide" aria-labelledby="guide-title">
            <div><p className="eyebrow">Before the first call</p><h2 id="guide-title">Use CallNeuron in this order.</h2><p>This prototype places real calls. Only contact an adult who gave valid permission for automated, processed and transcribed outreach.</p></div>
            <ol><li><strong>Approve</strong><span>Enter only words the caller may say.</span></li><li><strong>Load</strong><span>Add a recipient manually or import a local file.</span></li><li><strong>Verify</strong><span>Review evidence for the selected adult.</span></li><li><strong>Connect</strong><span>Authorize CALL-E and create a no-call plan.</span></li><li><strong>Confirm</strong><span>Place one call, then record human follow-up.</span></li></ol>
            <details><summary>Privacy and operating limits</summary><ul><li>Shortlist data is stored in this browser only; the original file is never uploaded.</li><li>CALL-E credentials, plan confirmations and transcripts stay in memory and disappear when this tab closes.</li><li>CallNeuron does not rank students, award scholarships, schedule retries or make eligibility decisions.</li><li>Deleting the local campaign does not delete provider-side CALL-E call records.</li></ul></details>
          </section>

          <figure className="hero-signal" aria-labelledby="signal-title">
            <div className="hero-signal__waves" aria-hidden="true"><span /><span /><span /><span /></div>
            <figcaption className="hero-signal__caption"><p className="eyebrow">Current campaign</p><h2 id="signal-title">Ready only when the evidence is.</h2><p>{campaignReady ? "The brief and at least one unattempted recipient are ready for consent review." : "Complete the brief and add a consent-ready adult before connecting CALL-E."}</p></figcaption>
            <div className="hero-signal__metric"><span>Real calls placed</span><strong>{results.length}</strong><p>Every call needs its own reviewed plan and confirmation.</p></div>
            <div className="hero-signal__status" aria-label="Campaign readiness summary"><span><strong>{availableRecipients.length}</strong> available</span><span><strong>{recipients.length - eligibleRecipients.length}</strong> blocked</span><span><strong>{connection ? 1 : 0}</strong> CALL-E session</span></div>
          </figure>

          <nav id="campaign-stages" className="stage-nav" aria-label="Campaign stages">
            {stages.map((label, index) => <button className={index === stage ? "stage-nav__item stage-nav__item--active" : "stage-nav__item"} type="button" aria-current={index === stage ? "step" : undefined} disabled={index > furthestStage} onClick={() => setStage(index)} key={label}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}
          </nav>

          <section ref={stagePanelRef} tabIndex={-1} className="stage-panel" aria-labelledby={`stage-${stage}-title`}>
            {stage === 0 && <div className="stage-layout"><div className="stage-intro"><p className="eyebrow">01 / Offer</p><h2 id="stage-0-title">Approve every word before anyone hears it.</h2><p>Use your real name or organization, a public callback number and only confirmed offer details. Unknown questions always return to a person.</p></div><article className="offer-card"><div className="card-meta"><span>Local approved brief</span><span>Required before planning</span></div><div className="form-grid"><label><span>Organization or your name</span><input value={offer.organization} maxLength={120} onChange={(event) => setOffer({ ...offer, organization: event.target.value })} /></label><label><span>Public callback · E.164</span><input type="tel" placeholder="+60…" value={offer.callbackPhone} maxLength={16} onChange={(event) => setOffer({ ...offer, callbackPhone: event.target.value })} /></label><label className="form-grid__wide"><span>Approved offer sentence</span><textarea placeholder="State the opportunity without implying an award." value={offer.offer} maxLength={500} onChange={(event) => setOffer({ ...offer, offer: event.target.value })} /></label><label className="form-grid__wide"><span>Approved factual details</span><textarea placeholder="Coverage, duration, available places, next step…" value={offer.details} maxLength={1000} onChange={(event) => setOffer({ ...offer, details: event.target.value })} /></label><label className="form-grid__wide"><span>Questions that must go to a human</span><textarea value={offer.escalation} maxLength={500} onChange={(event) => setOffer({ ...offer, escalation: event.target.value })} /></label></div><p className="inline-note">Never enter grades, identity documents, financial records, payment details or promises of an award.</p>{!offerValid && <p className="form-error">Complete every field and use an E.164 callback number beginning with +.</p>}<button className="button button--primary" type="button" disabled={!offerValid} onClick={() => { persist(recipients, dispositions, offer).catch(() => undefined); advance(1, "Approved brief saved locally. No CALL-E plan or call exists yet."); }}>Save and choose recipients</button></article></div>}

            {stage === 1 && <div className="stage-layout"><div className="stage-intro"><p className="eyebrow">02 / Recipients</p><h2 id="stage-1-title">Add only adults you are allowed to contact.</h2><p>Add one person manually or import CSV, XLSX, one-table DOCX or selectable-text PDF below 50 MB. Normalized rows stay in IndexedDB on this device.</p><div className="format-row" aria-label="Supported local import formats"><span>CSV</span><span>XLSX</span><span>DOCX</span><span>Text PDF</span><span>&lt; 50 MB</span><span>500 rows max</span></div><label className="file-picker"><span>{importBusy ? "Reading locally…" : "Import and replace current recipients"}</span><input type="file" accept=".csv,.xlsx,.docx,.pdf" disabled={importBusy} onChange={(event) => handleImport(event.target.files?.[0])} /></label><a className="text-button" href="/shortlist-template.csv" download>Download CSV template</a><ManualRecipientForm existingCodes={recipients.map((recipient) => recipient.studentCode)} onAdd={addManualRecipient} />{importError && <p className="form-error" role="alert">{importError}</p>}{importWarnings.length > 0 && <details className="warning-detail"><summary>{importWarnings.length} rows rejected safely</summary><ul>{importWarnings.slice(0, 10).map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}</div><div className="shortlist-preview"><div className="card-meta"><span>{sourceName}</span><span>{recipients.length} valid records</span></div>{recipients.length ? recipients.slice(0, 12).map((recipient) => { const attempted = Boolean(runs[recipient.id]); return <label className={`recipient-row recipient-row--${recipient.status}`} key={recipient.id}><input type="radio" name="selected-recipient" disabled={recipient.status !== "eligible" || attempted} checked={selectedRecipientId === recipient.id && !attempted} onChange={() => selectRecipient(recipient.id)} /><div><strong>{recipient.studentName}</strong><small>{recipient.studentCode} · owner {recipient.employeeCode}</small></div><div><span>{attempted ? "Already attempted" : recipient.recipientType === "guardian" ? "Guardian" : "Adult student"}</span><small>{maskPhone(recipient.phone)}</small></div></label>; }) : <div className="empty-state"><h3>No recipients yet.</h3><p>Add one manually or import a supported file. Nothing has been sent to CALL-E.</p></div>}{recipients.length > 12 && <p className="inline-note">Showing 12 of {recipients.length} locally validated records.</p>}<p className="inline-note">Blocked consent and already-attempted recipients cannot enter a new plan in this campaign.</p><button className="button button--primary" type="button" disabled={!selectedRecipient || Boolean(runs[selectedRecipient.id])} onClick={() => advance(2, `${selectedRecipient?.studentCode || "No record"} selected for one-person consent review.`)}>Review selected consent</button></div></div>}

            {stage === 2 && selectedRecipient && <div className="stage-layout"><div className="stage-intro"><p className="eyebrow">03 / Consent</p><h2 id="stage-2-title">A phone number is not permission.</h2><p>Review the evidence for <strong>{selectedRecipient.recipientName}</strong>, the intended {selectedRecipient.recipientType === "guardian" ? "guardian" : "adult student"}. Consent recorded: {selectedRecipient.consentTimestamp}.</p><fieldset className="attestations"><legend>Operator attestation for this call</legend>{attestations.map((attestation, index) => <label key={attestation}><input type="checkbox" checked={checkedAttestations[index]} onChange={(event) => setCheckedAttestations((current) => current.map((checked, itemIndex) => itemIndex === index ? event.target.checked : checked))} /><span>{attestation}</span></label>)}</fieldset><button className="button button--primary" type="button" disabled={!checkedAttestations.every(Boolean)} onClick={() => advance(3, `Consent review complete for ${selectedRecipient.studentCode}. The next stage still cannot call without a reviewed CALL-E plan and final confirmation.`)}>Confirm evidence for this call</button></div><article className="consent-card consent-card--eligible"><div className="card-meta"><span>{selectedRecipient.studentCode}</span><span>Consent active</span></div><h3>{selectedRecipient.recipientName}</h3><p>{selectedRecipient.consentSource}</p><small>{selectedRecipient.consentTimestamp}</small><div className="consent-boundary"><strong>Disclosure boundary</strong><span>Confirm permission and identity before mentioning the student or opportunity.</span></div></article></div>}

            {stage === 3 && selectedRecipient && <div className="stage-layout"><div className="stage-intro"><p className="eyebrow">04 / Call</p><h2 id="stage-3-title">Review, connect, then confirm one real call.</h2><p>Selected: <strong>{selectedRecipient.recipientName}</strong> · {selectedRecipient.studentCode} · {maskPhone(selectedRecipient.phone)}. Creating a plan cannot ring the phone.</p><label className="voicemail-toggle"><input type="checkbox" checked={voicemail} onChange={(event) => setVoicemail(event.target.checked)} /><span><strong>Neutral voicemail</strong><small>Off by default · contains no student or offer detail</small></span></label>{voicemail && <p className="voicemail-copy"><strong>Exact voicemail:</strong> {voicemailCopy(offer)}</p>}<div className="call-safety-note"><strong>This is the consequential step.</strong><span>CALL-E can start only after sign-in, plan review and the final real-call checkbox. Closing or refreshing this tab discards the in-memory connection and transcript view.</span></div></div><div className="preview-stack"><article className="disclosure-card"><div className="card-meta"><span>Disclosure budget</span><span>Before identity</span></div><h3>Organization, automation disclosure and permission request only.</h3><ul><li>Introduce CallNeuron and explain why it is calling.</li><li>Disclose processing/transcription and ask permission.</li><li>Confirm the intended adult before revealing the offer.</li><li>Never collect grades, finances, ID, payment or documents.</li></ul></article><article className="script-card"><div className="card-meta"><span>Warm, concise conversation</span><span>Human handoff</span></div><p>“Hello, my name is CallNeuron. I am an automated assistant calling on behalf of {offer.organization}. I am calling to share an education-support opportunity and to see whether you would like a human staff member to explain it.”</p><ol><li>Ask permission to continue.</li><li>Confirm the intended adult.</li><li>Explain only the approved facts.</li><li>Invite questions and record requested details.</li><li>Ask about interest and preferred human callback time.</li></ol><p className="handoff-promise"><strong>If interested:</strong> “Thank you for your interest. A human staff member from {offer.organization} will contact you shortly to guide you through the details.”</p></article><LiveCallPanel key={selectedRecipient.id} recipient={selectedRecipient} offer={offer} voicemail={voicemail} connection={connection} existingRun={runs[selectedRecipient.id] || null} onConnectionChange={setConnection} onRunUpdate={(run) => updateRun(selectedRecipient.id, run)} onComplete={() => advance(4, "CALL-E finished provider processing. Review the result and assign the human follow-up outcome.")} /><div className="call-count"><span>Unattempted / total eligible</span><strong>{availableRecipients.length} / {eligibleRecipients.length}</strong><small>One reviewed confirmation per real call. No batch dispatch or automatic retry.</small></div></div></div>}

            {stage === 4 && <div><div className="monitor-heading"><div className="stage-intro"><p className="eyebrow">05 / Follow-up</p><h2 id="stage-4-title">The call ends. Your responsibility does not.</h2><p>Read CALL-E’s provider result as untrusted call data, assign the human disposition, and follow up using the preference or question captured in the transcript.</p></div><div className="metrics" aria-label="Campaign metrics"><div><span>Attempted</span><strong>{metrics.attempted}</strong></div><div><span>Resolved</span><strong>{metrics.resolved}</strong></div><div className="metric--amber"><span>Follow-up</span><strong>{metrics.followUp}</strong></div><div><span>Resolution</span><strong>{metrics.resolutionRate}%</strong></div></div></div>{results.length ? <div className="results-list">{results.map((result) => { const recipient = recipients.find((item) => item.id === result.recipientId); return <article className="result-card result-card--completed" key={result.recipientId}><div className="result-card__summary"><div className="card-meta"><span>{recipient?.studentCode}</span><span>{result.providerSignal.replaceAll("_", " ")}</span></div><h3>{recipient?.recipientName} · {maskPhone(recipient?.phone || "")}</h3><p>{result.summary}</p><small>{result.attemptedAt}</small></div><div className="review-control"><label htmlFor={`disposition-${result.recipientId}`}>Human follow-up disposition</label><select id={`disposition-${result.recipientId}`} value={dispositions[result.recipientId] || "unreviewed"} onChange={(event) => changeDisposition(result.recipientId, event.target.value as Disposition)}>{Object.entries(dispositionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>{result.transcript && <details><summary>Review CALL-E transcript</summary><pre>{result.transcript}</pre></details>}</article>; })}</div> : <div className="empty-state"><h3>No call result yet.</h3><p>Return to Call. A plan and final confirmation are required before a phone can ring.</p></div>}<div className="monitor-actions"><button className="button button--primary" type="button" disabled={!availableRecipients.length} onClick={callAnotherRecipient}>Prepare another recipient</button><button className="button button--secondary" type="button" disabled={!results.length} onClick={() => downloadCsv(buildCampaignCsv(results, dispositions, recipients))}>Export privacy-minimal CSV</button><button className="text-button text-button--danger" type="button" onClick={() => setResetArmed(true)}>Reset local campaign</button></div>{resetArmed && <div className="reset-confirm" role="alert"><div><strong>Delete the local campaign?</strong><span>This removes the brief, recipient rows and dispositions from this browser. It cannot delete CALL-E provider records.</span></div><div className="live-actions"><button className="button button--danger" type="button" onClick={resetCampaign}>Delete local campaign</button><button className="button button--secondary" type="button" onClick={() => setResetArmed(false)}>Cancel</button></div></div>}</div>}
          </section>
          <p className="global-status" role="status" aria-live="polite">{message}</p>
        </main>
        <footer className="site-footer"><span>Individual operator prototype · local-first campaign data</span><span>English · Malaysia · CALL-E powered</span></footer>
      </div>
    </>
  );
}
