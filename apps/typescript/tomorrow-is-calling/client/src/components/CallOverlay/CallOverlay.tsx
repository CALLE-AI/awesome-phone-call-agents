import { useEffect, useRef } from "react";
import { useCallECall } from "../../hooks/useCallECall";
import type { CallEResponse } from "../../services/callEApi";
import type { PrototypeCallState } from "../../types/call";
import type { CallTask, TransportRequest } from "../../types/transport";
import { SignalOrb } from "../SignalOrb/SignalOrb";
import "./CallOverlay.css";

type Props = {
  request: TransportRequest;
  task: CallTask;
  onClose: () => void;
  onReturnHome: () => void;
  onViewReport: (result: CallEResponse) => void;
};

const stageCopy: Partial<Record<PrototypeCallState, string>> = {
  preparing: "Preparing CALL-E follow-up",
  dialing: "CALL-E queued the call",
  ringing: "Phone ringing",
  connected: "Connection established",
  conversation: "Live CALL-E conversation in progress",
  processing: "Processing structured outcome",
  complete: "CALL-E outcome ready",
};

export function CallOverlay({ request, task, onClose, onReturnHome, onViewReport }: Props) {
  const call = useCallECall(request);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const active = ["preparing", "dialing", "ringing", "connected", "conversation", "processing"].includes(call.state);
  const failed = call.state === "failed" || call.state === "cancelled";

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => openerRef.current?.focus();
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [call.state]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !active) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose]);

  return (
    <div className="call-overlay-backdrop">
      <section className="call-overlay" role="dialog" aria-modal="true" aria-labelledby="call-overlay-title" ref={dialogRef}>
        <header className="call-overlay__top">
          <div>
            <p className="eyebrow">CALL-E coordination monitor</p>
            <span className="call-overlay__prototype">LIVE OUTBOUND CALL · SERVER-SIDE CALL-E API</span>
          </div>
          {!active && <button className="overlay-close" onClick={onClose}>Close</button>}
        </header>

        <div className="call-overlay__shipment">
          <div><small>Transport reference</small><strong>{request.reference}</strong></div>
          <div><small>Calling</small><span>{task.recipient.fullName}</span></div>
          <div><small>Role / purpose</small><span>{task.recipientRole.replace("_", " ")} · {task.type.replace("-", " ")}</span></div>
          <div><small>Vehicle / route</small><span>{request.vehicle.year} {request.vehicle.make} {request.vehicle.model} · {request.pickup.address} → {request.delivery.address}</span></div>
        </div>

        <main className="call-overlay__monitor">
          <SignalOrb state={call.state} />
          <div className="call-overlay__status">
            <p className="meta-label" aria-live="polite">Current call stage</p>
            <h2 id="call-overlay-title" ref={headingRef} tabIndex={-1}>{failed ? "CALL-E call could not continue" : stageCopy[call.state]}</h2>
            <p className="call-overlay__scenario">{task.goal}</p>
            {call.callId && <p className="call-overlay__guidance">CALL-E call ID: {call.callId}</p>}
            {call.state === "dialing" && <p className="call-overlay__guidance">The call has been queued. Carrier connection can take several seconds before the recipient's phone rings.</p>}
            {call.state === "conversation" && <><time className="call-overlay__timer" aria-label={`Elapsed call duration ${formatDuration(call.duration)}`}>{formatDuration(call.duration)}</time><p className="call-overlay__guidance">The real phone conversation is in progress. This page polls CALL-E for the terminal result.</p></>}
            {call.state === "complete" && <p className="call-overlay__guidance">{call.result?.summary ?? "CALL-E completed the call and returned an outcome."}</p>}
            {failed && <p className="call-overlay__guidance" role="alert">{call.error ?? call.result?.failure_message ?? "The CALL-E call failed or was canceled."}</p>}
            <p className="prototype-notice">Voice audio happens on the recipient's phone; this browser only monitors CALL-E status.</p>
          </div>
        </main>

        <footer className="call-overlay__controls">
          {active && <button className="button button--primary" disabled>CALL-E is working…</button>}
          {call.state === "complete" && call.result && <><button className="button button--primary" onClick={() => onViewReport(call.result!)}>View call outcome</button><button className="button button--quiet" onClick={onReturnHome}>Return to transport queue</button></>}
          {failed && <><button className="button button--primary" onClick={() => void call.retry()}>Try again</button><button className="button button--quiet" onClick={onClose}>Return to call brief</button><button className="button button--quiet" onClick={onReturnHome}>Return to transport queue</button></>}
        </footer>
      </section>
    </div>
  );
}

function formatDuration(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
}
