import { useState } from "react";

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

type Props = {
  recipient: Recipient;
  offer: OfferBrief;
  voicemail: boolean;
  connection: CallEConnection | null;
  existingRun: CallRun | null;
  onConnectionChange: (connection: CallEConnection | null) => void;
  onRunUpdate: (run: CallRun) => void;
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

export function LiveCallPanel({ recipient, offer, voicemail, connection, existingRun, onConnectionChange, onRunUpdate, onComplete }: Props) {
  const [login, setLogin] = useState<PendingLogin | null>(null);
  const [plan, setPlan] = useState<ReviewedPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [run, setRun] = useState<CallRun | null>(existingRun);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(existingRun
    ? `CALL-E previously reported ${existingRun.status}. This campaign will not create another plan for the same recipient.`
    : connection
    ? "CALL-E is connected for this browser tab. Creating a plan cannot ring a phone."
    : "Connect your CALL-E account when you are ready. No call is planned yet.");
  const [error, setError] = useState("");

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
    if (!connection) return;
    setBusy(true);
    setError("");
    setConfirmed(false);
    try {
      const reviewed = await createReviewedPlan(connection, recipient, offer, voicemail);
      setPlan(reviewed);
      setStatus("CALL-E returned a ready plan. The phone has not been called. Review and confirm the immutable summary below.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The call plan could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function dispatch() {
    if (!connection || !plan || !confirmed || run) return;
    setBusy(true);
    setError("");
    try {
      const start = () => startReviewedCall(connection, plan);
      const started = navigator.locks
        ? await navigator.locks.request("call-neuron-live-dispatch", { ifAvailable: true }, async (lock) => {
            if (!lock) throw new Error("Another CallNeuron tab is dispatching. Close it before placing a call.");
            return start();
          })
        : await start();
      setRun(started);
      onRunUpdate(started);
      setStatus("CALL-E accepted the call. CallNeuron will read status only; it will never retry automatically.");

      let current = started;
      for (let attempt = 0; attempt < 120 && !terminalStatuses.has(current.status.toUpperCase()); attempt += 1) {
        await wait(5_000);
        current = await refreshCallRun(connection, current);
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
      setError(caught instanceof Error ? caught.message : "CALL-E could not start or read the call.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshOnce() {
    if (!connection || !run) return;
    setBusy(true);
    setError("");
    try {
      const current = await refreshCallRun(connection, run);
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
      {connection && !plan && !run && <div className="live-actions"><button className="button button--secondary" type="button" disabled={busy} onClick={preparePlan}>Create CALL-E plan · no call</button><button className="text-button" type="button" disabled={busy} onClick={() => { onConnectionChange(null); setStatus("CALL-E disconnected from this tab. No call was created."); }}>Disconnect</button></div>}

      {plan && !run && (
        <div className="live-confirmation">
          <dl>
            <div><dt>Recipient</dt><dd>{recipient.recipientName} · {recipient.studentCode}</dd></div>
            <div><dt>Phone</dt><dd>Ends {recipient.phone.slice(-4)}</dd></div>
            <div><dt>Language / region</dt><dd>English / Malaysia</dd></div>
            <div><dt>Voicemail</dt><dd>{voicemail ? "Neutral callback only" : "Off"}</dd></div>
            <div><dt>Retries</dt><dd>None</dd></div>
            <div><dt>Confirmation expires</dt><dd>{plan.expiresAt}</dd></div>
          </dl>
          <details><summary>Review exact CALL-E instruction</summary><p>{plan.instruction}</p></details>
          <label className="danger-confirm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I understand the next button places one real phone call now.</span>
          </label>
          <button className="button button--danger" type="button" disabled={!confirmed || busy} onClick={dispatch}>Confirm and place one call</button>
        </div>
      )}

      {run && <><p className="run-status"><span>Provider status</span><strong>{run.status}</strong><small>Run ending {run.runId.slice(-6)}</small></p>{!terminalStatuses.has(run.status.toUpperCase()) && <button className="button button--secondary" type="button" disabled={busy} onClick={refreshOnce}>Check status now</button>}</>}
    </article>
  );
}
