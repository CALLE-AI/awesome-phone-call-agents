import { StatusBadge } from "../../components/StatusBadge/StatusBadge";
import type { TransportOperation } from "../../types/transport";
import "./OverviewPage.css";

const label = (status: string) => status.replaceAll("_", " ");

type Props = {
  operations: TransportOperation[];
  onOpenRequest: (reference: string) => void;
  onPublicSite: () => void;
};

export function OverviewPage({ operations, onOpenRequest, onPublicSite }: Props) {
  return (
    <main className="page overview">
      <section className="hero">
        <p className="eyebrow">Transport coordination console</p>
        <h1>Review customer requests and keep every vehicle handoff moving.</h1>
        <p>Requests submitted from the public service page appear here for staff review, customer confirmation, and driver coordination.</p>
        <button className="button button--secondary" id="overview-start-check" onClick={onPublicSite}>View public service page</button>
      </section>

      <section className="operations-queue" aria-labelledby="queue-heading">
        <div className="operations-queue__heading">
          <div><p className="section-label">Transport requests</p><h2 id="queue-heading">Customer intake and coordination queue.</h2></div>
        </div>
        <div className="queue-list">
          {operations.map((operation) => (
            <article className={`queue-row ${operation.isInteractive ? "queue-row--active" : ""}`} key={operation.id}>
              <div className="queue-row__operation"><strong>{operation.reference}</strong><span>{operation.customer} · {operation.vehicle}</span></div>
              <div><small>Route</small><span>{operation.route}</span></div>
              <div><small>Status</small><StatusBadge tone={operation.isInteractive ? "attention" : operation.status === "completed" ? "ready" : "active"}>{label(operation.status)}</StatusBadge></div>
              <div><small>Next action</small><span className="queue-state">{operation.nextAction}</span></div>
              <div className="queue-row__action">{operation.isInteractive ? <button className="button button--secondary" onClick={() => onOpenRequest(operation.reference)}>Open request</button> : <span className="sample-label">Sample request</span>}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="how">
        <p className="section-label">Staff coordination path</p>
        <ol><li><b>01</b><span>Customer request submitted → staff review</span></li><li><b>02</b><span>CALL-E confirmation → questions and special instructions captured</span></li><li><b>03</b><span>Driver assignment → pickup updates → delivery completed</span></li></ol>
      </section>
    </main>
  );
}
