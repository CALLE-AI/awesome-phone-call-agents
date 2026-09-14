import type { TransportRequestForm } from "../../types/transport";
import "./ReviewCallPage.css";

export function ReviewCallPage({ data, onBegin, onBack }: { data: TransportRequestForm; onBegin: () => void; onBack: () => void }) {
  const rows = [
    ["Transport request", data.reference],
    ["Customer", `${data.customer.fullName} · ${data.customer.phone}`],
    ["Vehicle", `${data.vehicle.year} ${data.vehicle.make} ${data.vehicle.model}`],
    ["Route", `${data.pickup.address} → ${data.delivery.address}`],
    ["Pickup window", data.pickup.preferredWindow],
    ["Delivery window", data.delivery.preferredWindow],
    ["Expected call duration", "3–5 minutes"],
  ];

  return (
    <main className="page review">
      <p className="eyebrow">Staff confirmation call brief</p>
      <h1>Confirm the customer request before dispatch.</h1>
      <p className="prototype-notice">This action places a real outbound CALL-E call to the customer phone shown below.</p>
      <dl>{rows.map(([term, description]) => <div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
      <section>
        <p className="section-label">Reason</p><p>Pre-transport customer confirmation</p>
        <p className="section-label">Goal</p><p>Confirm identity and transport details, explain the next steps toward driver dispatch, capture questions or special instructions, and flag anything that needs human follow-up.</p>
        <p className="section-label">CALL-E will cover</p>
        <ul>{["Confirm it is speaking with the customer", "Review vehicle and transport windows", "Explain that driver/transport updates will follow", "Ask for questions or special instructions", "Capture blockers and human follow-up needs"].map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <div className="form-actions"><button className="button button--primary" onClick={onBegin}>Place live CALL-E call</button><button className="button button--quiet" onClick={onBack}>Back to queue</button></div>
    </main>
  );
}
