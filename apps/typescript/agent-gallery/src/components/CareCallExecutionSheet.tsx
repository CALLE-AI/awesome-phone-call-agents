import { useEffect, useMemo, useRef, useState } from "react";
import { ACCESS_CODE_HEADER } from "../access";
import type { CalleRunResult } from "../calle";
import { maskE164 } from "../calle";
import type { CareRoutine, Senior } from "../carecall/types";
import {
  buildCareCallResult,
  type CareCallRequest,
  type CareCallResult,
} from "../workflows/carecall";
import { Icon } from "./Icon";

type Stage = "authorize" | "live" | "result";
const E164 = /^\+[1-9]\d{7,14}$/;

interface StatusPayload {
  status: string;
  activity?: { ts: string; level: string; message: string }[];
  calle_result?: CalleRunResult | null;
  error?: string;
}

export function CareCallExecutionSheet({ routine, senior, onClose, onCompleted }: { routine: CareRoutine; senior: Senior; onClose: () => void; onCompleted: (result: CareCallResult) => void }) {
  const [stage, setStage] = useState<Stage>("authorize");
  const [phone, setPhone] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [request, setRequest] = useState<CareCallRequest | null>(null);
  const [status, setStatus] = useState("starting");
  const [activity, setActivity] = useState<StatusPayload["activity"]>([]);
  const [result, setResult] = useState<CareCallResult | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const validPhone = E164.test(phone);

  const stageTitle = useMemo(() => ({
    authorize: "Authorize one CareCall",
    live: "CareCall in progress",
    result: result?.outcome_label ?? "Call result",
  })[stage], [stage, result]);

  useEffect(() => { titleRef.current?.focus(); }, [stage]);

  async function startCall() {
    const payload: CareCallRequest = {
      workflow: "carecall",
      request_key: crypto.randomUUID(),
      organisation: { name: "Queenstown Care Team", timezone: "Asia/Singapore" },
      senior: {
        id: senior.id,
        preferred_name: senior.preferredName,
        phone_e164: phone,
        language: "English",
        authority_confirmed: true,
        permitted_call_window: senior.callWindow,
      },
      routine: {
        id: routine.id,
        kind: routine.kind,
        title: routine.title,
        caregiver_instruction: routine.caregiverInstruction,
        caregiver_name: senior.caregiver,
        trust_phrase: routine.trustPhrase,
      },
      authorization: { exactly_one_call: true, authorized_at: new Date().toISOString() },
    };
    setSubmitting(true);
    setError(null);
    setRequest(payload);
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json", [ACCESS_CODE_HEADER]: accessCode },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { call_id?: string; error?: string; message?: string };
      if (!response.ok || !body.call_id) {
        setError(body.error === "invalid_access_code" ? "The operator access code was not accepted. No call was placed." : (body.message ?? body.error ?? "The call could not be started."));
        setSubmitting(false);
        return;
      }
      setCallId(body.call_id);
      setStage("live");
    } catch {
      setError("The server could not confirm whether a call was created. Do not retry blindly; check CALL-E first.");
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (stage !== "live" || !callId || !request) return;
    const activeRequest = request;
    const activeCallId = callId;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(activeCallId)}`, { headers: { [ACCESS_CODE_HEADER]: accessCode } });
        const body = await response.json() as StatusPayload;
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error ?? "Call status could not be read. The call may still be running.");
          return;
        }
        setStatus(body.status);
        setActivity(body.activity ?? []);
        if (body.calle_result !== undefined) {
          const completed = buildCareCallResult({ request: activeRequest, status: body.status, calle: body.calle_result ?? null, runId: activeCallId });
          setResult(completed);
          onCompleted(completed);
          setStage("result");
        }
      } catch {
        if (!cancelled) setError("Connection to the status service was lost. The call may still be running.");
      }
    }
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [accessCode, callId, onCompleted, request, stage]);

  return (
    <div className="sheet-backdrop">
      <section aria-labelledby="execution-title" aria-modal="true" className="call-sheet execution-sheet" role="dialog">
        <header className="call-sheet__header">
          <div>
            <span className="dry-run-badge" data-live={stage === "live"}><Icon name={stage === "result" ? "check" : "shield"} size={14} /> {stage === "authorize" ? "Live call gate" : stage === "live" ? "Real call · status polling" : "Structured result"}</span>
            <h2 id="execution-title" ref={titleRef} tabIndex={-1}>{stageTitle}</h2>
            <p>{senior.preferredName} · {routine.title} · {phone ? maskE164(phone) : senior.phoneMasked}</p>
          </div>
          {stage !== "live" && <button aria-label="Close" className="icon-button" onClick={onClose} type="button"><Icon name="close" /></button>}
        </header>

        <div className="call-sheet__content execution-content">
          {stage === "authorize" && (
            <>
              <section className="authorization-warning"><Icon name="attention" size={20} /><div><strong>This places one real phone call.</strong><p>The number and access code are used for this call only and are not saved in the browser.</p></div></section>
              <label className="execution-field"><span>Authorized senior phone number</span><input autoComplete="off" inputMode="tel" onChange={(event) => setPhone(event.target.value.trim())} placeholder="+65…" type="tel" value={phone} /><small>Enter the E.164 number from the protected senior record. The demo fixture stores only a masked number.</small></label>
              <label className="execution-field"><span>Operator access code</span><input autoComplete="off" onChange={(event) => setAccessCode(event.target.value)} type="password" value={accessCode} /></label>
              <label className="authorization-check"><input checked={confirmed} disabled={submitting} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" /><span>I confirm I am authorized to contact {senior.preferredName} and authorize exactly one call now for the {routine.title.toLowerCase()} shown in the preview.</span></label>
              {phone && !validPhone && <p className="field-error" role="alert">Use an international E.164 number, for example +65 followed by the local number.</p>}
              <section className="boundary-note"><Icon name="shield" size={18} /><p>CareCall records self-reports and requests human follow-up. It does not give medical advice or dispatch emergency services.</p></section>
            </>
          )}

          {stage === "live" && (
            <>
              <section className="live-state"><span className="live-pulse" /><div><p>Current delivery state</p><strong>{status.replaceAll("_", " ").toLowerCase()}</strong></div></section>
              <section className="preview-block"><p className="preview-label">Settled activity</p>{activity?.length ? <ol className="activity-list">{activity.map((entry, index) => <li key={`${entry.ts}-${index}`}><time>{new Date(entry.ts).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time><span>{entry.message}</span></li>)}</ol> : <p>Preparing the call and waiting for the first provider update…</p>}</section>
              <p className="muted-copy">Do not close or retry while creation or delivery is uncertain. This view will move to a result when CALL-E reaches a terminal state.</p>
            </>
          )}

          {stage === "result" && result && (
            <>
              <section className="result-hero" data-follow-up={result.follow_up_required}><Icon name={result.follow_up_required ? "attention" : "check"} size={24} /><div><p>{result.self_reported ? "Senior self-report" : "Care outcome"}</p><h3>{result.outcome_label}</h3><span>{result.next_action}</span></div></section>
              <dl className="result-details"><div><dt>Human follow-up</dt><dd>{result.follow_up_required ? "Required" : "Not currently required"}</dd></div><div><dt>Operational urgency</dt><dd>{result.urgency.replaceAll("-", " ")}</dd></div><div><dt>Provider status</dt><dd>{result.provider_status}</dd></div><div><dt>Audit ID</dt><dd>{result.call_id}</dd></div><div><dt>Evidence</dt><dd>{result.evidence ?? "No reliable conversational evidence was returned."}</dd></div></dl>
              {result.safety_flags.length > 0 && <section className="execution-error" role="alert"><strong>Safety review flags</strong><ul className="safety-flag-list">{result.safety_flags.map((flag) => <li key={flag}>{flag.replaceAll("_", " ")}</li>)}</ul></section>}
              <section className="boundary-note"><Icon name="info" size={18} /><p>Provider completion is kept separate from the senior’s reported care outcome. Ambiguity always routes to human review.</p></section>
            </>
          )}

          {error && <div className="execution-error" role="alert"><strong>Call action needs attention</strong><p>{error}</p></div>}
        </div>

        <footer className="call-sheet__footer execution-footer">
          <div><Icon name="info" size={17} /><span>{stage === "authorize" ? "Recurring schedules remain disabled in this milestone." : stage === "live" ? "The final transcript is treated as untrusted call data." : "Record any real follow-up in the authorized care system."}</span></div>
          {stage === "authorize" && <button className="primary-button primary-button--attention" disabled={!confirmed || !validPhone || !accessCode || submitting} onClick={startCall} type="button">{submitting ? "Starting one call…" : "Place one CareCall"}</button>}
          {stage === "result" && <button className="primary-button" onClick={onClose} type="button">Done</button>}
        </footer>
      </section>
    </div>
  );
}
