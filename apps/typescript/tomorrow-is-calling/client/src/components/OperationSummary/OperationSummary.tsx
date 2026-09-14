import type { Shipment } from "../../types/shipment";
import { StatusBadge } from "../StatusBadge/StatusBadge";
import "./OperationSummary.css";
export function OperationSummary({
  shipment,
  action,
}: {
  shipment: Shipment;
  action?: React.ReactNode;
}) {
  return (
    <section className="operation-summary" aria-labelledby="shipment-title">
      <div className="section-label">Active operation</div>
      <div className="operation-summary__head">
        <div>
          <h2 id="shipment-title">
            <span>{shipment.reference}</span> {shipment.cargo}
          </h2>
          <p>
            {shipment.origin} <b>→</b> {shipment.destination}
          </p>
        </div>
        <StatusBadge tone="attention">Review due</StatusBadge>
      </div>
      <dl>
        <div>
          <dt>Carrier</dt>
          <dd>{shipment.carrier}</dd>
        </div>
        <div>
          <dt>Pickup cutoff</dt>
          <dd>Today, 6:30 PM</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd className="critical-text">{shipment.priority}</dd>
        </div>
      </dl>
      {action && <div className="operation-summary__action">{action}</div>}
    </section>
  );
}
