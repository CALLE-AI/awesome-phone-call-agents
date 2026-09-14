import { useEffect, useState } from "react";
import { SignalOrb } from "../../components/SignalOrb/SignalOrb";
import { StatusBadge } from "../../components/StatusBadge/StatusBadge";
import "./CallStatusPage.css";
export function CallStatusPage({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [seconds, setSeconds] = useState(94);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const duration = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <main className="page call-status">
      <div className="call-status__top">
        <p className="eyebrow">Voice readiness check</p>
        <StatusBadge tone="active">Connected — Prototype</StatusBadge>
      </div>
      <h1>
        Shipment <span>SH-2048</span>
      </h1>
      <p className="call-countdown">
        Pickup cutoff · Today 6:30 PM <b>Prototype window: 02:14:00</b>
      </p>
      <section className="call-stage">
        <SignalOrb />
        <div className="call-stage__state">
          <p className="meta-label">Current review</p>
          <h2>Carrier confirmation</h2>
          <p>Reviewing operator response</p>
          <time>Call duration {duration}</time>
        </div>
      </section>
      <dl className="call-meta">
        <div>
          <dt>Caller identity</dt>
          <dd>Operations Risk Agent</dd>
        </div>
        <div>
          <dt>Origin code</dt>
          <dd>SAT-03</dd>
        </div>
        <div>
          <dt>Destination code</dt>
          <dd>HOU-11</dd>
        </div>
        <div>
          <dt>Carrier</dt>
          <dd>Northline Express</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd className="critical-text">Critical</dd>
        </div>
      </dl>
      <div className="form-actions">
        <button className="button button--primary" onClick={onComplete}>
          Complete mock assessment
        </button>
        <button className="button button--quiet" onClick={onCancel}>
          Cancel assessment
        </button>
      </div>
    </main>
  );
}
