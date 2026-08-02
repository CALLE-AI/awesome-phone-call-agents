import { useEffect, useState } from "react";

import { exchangeLogin, readLoginStatus, startLogin, type PendingLogin } from "./api";
import type { Recipient } from "./campaign";
import {
  createReviewedPlan,
  initializeCallE,
  refreshCallRun,
  startReviewedCall,
  type CallEConnection,
  type CallRun,
  type OfferBrief,
  type ReviewedPlan,
} from "./live";
import {
  abandonUnstartedDispatch,
  beginDispatch,
  markAcceptanceUnknown,
  recordAcceptedRun,
  recordReviewedPlan,
  recordRunStatus,
  reserveDispatch,
  type DispatchAttempt,
} from "./persistence";

type Props = {
  recipient: Recipient;
  offer: OfferBrief;
  voicemail: boolean;
  connection: CallEConnection | null;
  existingRun: CallRun | null;
  existingAttempt: DispatchAttempt | null;
  onConnectionChange: (connection: CallEConnection | null) => void;
  onRunUpdate: (run: CallRun) => void;
  onAttemptUpdate: (attempt: DispatchAttempt | null) => void;
  onComplete: () => void;
};

const terminalStatuses = new Set([
  "COMPLETED",
  "FAILED",
  "NO_ANSWER",
  "DECLINED",
  "CANCELED",
  "CANCELLED",
  "VOICEMAIL",
  "BUSY",
  "EXPIRED",
  "ERROR",
]);

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function initialStatus(attempt: DispatchAttempt | null, run: CallRun | null, connection: CallEConnection | null) {
  if (run) return `CALL-E previously reported ${run.status}. Only this persisted run ID can be refreshed; a second plan is blocked.`;
  if (attempt?.phase === "dispatching" || attempt?.phase === "acceptance_unknown") {
    return "A previous run_call has uncertain acceptance and no durable run ID. This recipient is locked against replanning; reconcile it in CALL-E provider records.";
  }
  if (attempt) return "An unstarted, content-bound plan reservation exists. It can be discarded safely because run_call was never entered.";
  return connection
    ? "CALL-E is connected for this browser tab. Creating a plan cannot ring a phone."
    : "Connect your CALL-E account when you are ready. No call is planned yet.";
}

export function LiveCallPanel({
  recipient,
  offer,
  voicemail,
  connection,
  existingRun,
  existingAttempt,
  onConnectionChange,
  onRunUpdate,
  onAttemptUpdate,
  onComplete,
}: Props) {
  const [login, setLogin] = useState<PendingLogin | null>(null);
  const [plan, setPlan] = useState<ReviewedPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [run, setRun] = useState<CallRun | null>(existingRun);
  const [attempt, setAttempt] = useState<DispatchAttempt | null>(existingAttempt);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(initialStatus(existingAttempt, existingRun, connection));
  const [error, setError] = useState("");

  useEffect(() => {
    setAttempt(existingAttempt);
    if (!plan && !run) setStatus(initialStatus(existingAttempt, existingRun, connection));
  }, [existingAttempt, existingRun, connection, plan, run]);

  useEffect(() => {
    if (existingRun) setRun(existingRun);
  }, [existingRun]);

  function updateAttempt(next: DispatchAttempt | null) {
    setAttempt(next);
    onAttemptUpdate(next);
  }

  async function beginLogin() {
    setBusy(true);
    setError("");
    try {
      const pending = await startLogin();
      setLogin(pending);
      setStatus("Secure CALL-E sign-in created. Open it, authorize, then return here.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CALL-E sign-in could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function finishLogin() {
    if (!login) return;
    setBusy(true);
    setError("");
    try {
      const loginStatus = await readLoginStatus(login);
      if (loginStatus === "EXCHANGED") {
        setLogin(null);
        throw new Error("This CALL-E sign-in was already exchanged. Start a fresh secure sign-in.");
      }
      if (loginStatus !== "AUTHORIZED") throw new Error(`CALL-E sign-in is ${loginStatus.toLowerCase()}. Finish authorization before checking again.`);
      const accessToken = await exchangeLogin(login);
      setLogin(null);
      const activeConnection = await initializeCallE(accessToken);
      onConnectionChange(activeConnection);
      setStatus("CALL-E connected. The next action creates a reviewable plan only; it cannot ring a phone.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CALL-E connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function preparePlan() {
    if (!connection || attempt || run) return;
    setBusy(true);
    setError("");
    setConfirmed(false);
    let reservation: DispatchAttempt | null = null;
    try {
      reservation = await reserveDispatch(recipient, offer, voicemail);
      updateAttempt(reservation);
      const reviewed = await createReviewedPlan(connection, recipient, offer, voicemail);
      const planned = await recordReviewedPlan(reservation, reviewed);
      updateAttempt(planned);
      setPlan(reviewed);
      setStatus("CALL-E returned a ready plan. The phone has not been called. Its content-bound reservation now blocks every other tab from planning this recipient.");
    } catch (caught) {
      if (reservation) {
        await abandonUnstartedDispatch(reservation).then(() => updateAttempt(null)).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : "The call plan could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function discardUnstartedPlan() {
    if (!attempt || !["planning", "planned"].includes(attempt.phase)) return;
    setBusy(true);
    setError("");
    try {
      await abandonUnstartedDispatch(attempt);
      updateAttempt(null);
      setPlan(null);
      setConfirmed(false);
      setStatus("The no-call reservation was discarded. No run_call had started, so a new reviewed plan is safe.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The unstarted reservation could not be discarded.");
    } finally {
      setBusy(false);
    }
  }

  async function dispatch() {
    if (!connection || !plan || !confirmed || run || !attempt || attempt.phase !== "planned") return;
    setBusy(true);
    setError("");

    let dispatching: DispatchAttempt;
    try {
      dispatching = await beginDispatch(attempt);
      updateAttempt(dispatching);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The durable dispatch gate failed. No call was started.");
      setBusy(false);
      return;
    }

    let started: CallRun;
    try {
      started = await startReviewedCall(connection, plan);
    } catch {
      const unknown = await markAcceptanceUnknown(dispatching).catch(() => dispatching);
      updateAttempt(unknown);
      setError("CALL-E acceptance is uncertain because run_call did not return a durable run ID. This recipient is permanently blocked from automatic retry; check CALL-E provider records before any manual action.");
      setBusy(false);
      return;
    }

    let accepted: DispatchAttempt;
    try {
      accepted = await recordAcceptedRun(dispatching, started);
      updateAttempt(accepted);
    } catch (caught) {
      setRun(started);
      onRunUpdate(started);
      setError(caught instanceof Error ? caught.message : "CALL-E accepted the call, but the run ID could not be stored. Never replan this recipient.");
      setBusy(false);
      return;
    }

    setRun(started);
    onRunUpdate(started);
    setStatus("CALL-E accepted the call and its run ID is stored locally. CallNeuron will read only this same run; it will never retry automatically.");

    try {
      let current = started;
      let currentAttempt = accepted;
      for (let poll = 0; poll < 120 && !terminalStatuses.has(current.status.toUpperCase()); poll += 1) {
        await wait(5_000);
        current = await refreshCallRun(connection, current);
        currentAttempt = await recordRunStatus(currentAttempt, current);
        updateAttempt(currentAttempt);
        setRun(current);
        onRunUpdate(current);
      }
      if (terminalStatuses.has(current.status.toUpperCase())) {
        setStatus(`CALL-E reported ${current.status}. A staff member must still assign the business disposition.`);
        onComplete();
      } else {
        setStatus("Automatic status checks paused after ten minutes. The call was not retried; use Check status now to continue monitoring this same run.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CALL-E status could not be read. The accepted run remains stored and will not be retried.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshOnce() {
    if (!connection || !run || !attempt || attempt.phase !== "accepted") return;
    setBusy(true);
    setError("");
    try {
      const current = await refreshCallRun(connection, run);
      const updatedAttempt = await recordRunStatus(attempt, current);
      updateAttempt(updatedAttempt);
      setRun(current);
      onRunUpdate(current);
      if (terminalStatuses.has(current.status.toUpperCase())) {
        setStatus(`CALL-E reported ${current.status}. A staff member must still assign the business disposition.`);
        onComplete();
      } else {
        setStatus(`CALL-E still reports ${current.status}. No retry was created.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CALL-E status could not be read.");
    } finally {
      setBusy(false);
    }
  }

  const unresolvedAcceptance = attempt?.phase === "dispatching" || attempt?.phase === "acceptance_unknown";
  const unstartedReservation = attempt?.phase === "planning" || attempt?.phase === "planned";

  return (
    <article className="live-panel" aria-labelledby="live-panel-title">
      <div className="card-meta"><span>CALL-E runtime</span><span>{connection ? "Connected in this tab" : "Not connected"}</span></div>
      <h3 id="live-panel-title">Controlled live-call gate</h3>
      <p>{status}</p>
      {error && <p className="form-error" role="alert">{error} No automatic retry was attempted.</p>}

      {!connection && !login && <button className="button button--secondary" type="button" disabled={busy} onClick={beginLogin}>Connect CALL-E</button>}
      {login && (
        <div className="live-actions">
          <a className="button button--secondary" href={login.loginUrl} target="_blank" rel="noreferrer">Open secure sign-in</a>
          <button className="button button--secondary" type="button" disabled={busy} onClick={finishLogin}>I authorized · check</button>
        </div>
      )}
      {connection && !plan && !run && !attempt && <div className="live-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={preparePlan}>Create CALL-E plan · no call</button><button className="text-button" type="button" disabled={busy} onClick={() => { onConnectionChange(null); setStatus("CALL-E disconnected from this tab. No call was created."); }}>Disconnect</button></div>}

      {unstartedReservation && !plan && (
        <div className="live-confirmation">
          <p><strong>Unstarted plan reservation.</strong> Its confirmation secret was not stored. Discarding it is safe because CallNeuron never entered <code>run_call</code>.</p>
          <button className="button button--secondary" type="button" disabled={busy} onClick={discardUnstartedPlan}>Discard unstarted reservation</button>
        </div>
      )}

      {unresolvedAcceptance && (
        <div className="live-confirmation">
          <p><strong>Fail-closed dispatch lock.</strong> CALL-E may have accepted the call, but no run ID was durably confirmed. Check provider records using plan ending {attempt?.planId?.slice(-6)}; do not create or run another plan for this recipient.</p>
        </div>
      )}

      {plan && !run && attempt?.phase === "planned" && (
        <div className="live-confirmation">
          <dl>
            <div><dt>Recipient</dt><dd>{recipient.recipientName} · {recipient.studentCode}</dd></div>
            <div><dt>Phone</dt><dd>Ends {recipient.phone.slice(-4)}</dd></div>
            <div><dt>Language / region</dt><dd>English / Malaysia</dd></div>
            <div><dt>Voicemail</dt><dd>{voicemail ? "Neutral callback only" : "Off"}</dd></div>
            <div><dt>Retries</dt><dd>None</dd></div>
            <div><dt>Confirmation expires</dt><dd>{plan.expiresAt}</dd></div>
            <div><dt>Content binding</dt><dd>{attempt.contentBinding.slice(0, 12)}</dd></div>
          </dl>
          <details><summary>Review exact CALL-E instruction</summary><p>{plan.instruction}</p></details>
          <label className="danger-confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I understand the next button places one real phone call now.</span>
          </label>
          <div className="live-actions">
            <button className="button button--danger" type="button" disabled={!confirmed || busy} onClick={dispatch}>Confirm and place one call</button>
            <button className="text-button" type="button" disabled={busy} onClick={discardUnstartedPlan}>Discard plan</button>
          </div>
        </div>
      )}

      {run && <><p className="run-status"><span>Provider status</span><strong>{run.status}</strong><small>Persisted run ending {run.runId.slice(-6)}</small></p>{!terminalStatuses.has(run.status.toUpperCase()) && <button className="button button--secondary" type="button" disabled={busy || attempt?.phase !== "accepted" || !connection} onClick={refreshOnce}>Check this run status</button>}</>}
    </article>
  );
}
