import type { TransportRequest } from "../../types/transport";
import "./RequestSubmittedPage.css";

type Props = {
  request: TransportRequest;
  onHome: () => void;
  onStaff: () => void;
};

export function RequestSubmittedPage({ request, onHome, onStaff }: Props) {
  return (
    <main className="page request-submitted">
      <p className="eyebrow">Request received</p>
      <h1>Thanks, {request.customer.fullName}.</h1>
      <p className="request-submitted__lead">
        Your transport request <strong>{request.reference}</strong> has been added to the coordination queue.
      </p>

      <section className="request-submitted__card">
        <div><small>Vehicle</small><strong>{request.vehicle.year} {request.vehicle.make} {request.vehicle.model}</strong></div>
        <div><small>Route</small><strong>{request.pickup.address} → {request.delivery.address}</strong></div>
        <div><small>What happens next</small><strong>A coordinator reviews your request and may call to confirm the details before driver dispatch.</strong></div>
        <div><small>Updates</small><strong>We’ll keep you updated as pickup approaches and send confirmation by email.</strong></div>
      </section>

      <div className="form-actions">
        <button className="button button--primary" onClick={onHome}>Return to service page</button>
        <button className="button button--quiet" onClick={onStaff}>Staff console</button>
      </div>
    </main>
  );
}
