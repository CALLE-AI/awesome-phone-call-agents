import { DefinitionList } from "./DefinitionList.js";
import { StatusBadge } from "./StatusBadge.js";

export type ExportState = "pending" | "approved" | "rejected";

interface ExportDecisionProps {
  enabled: boolean;
  exportState: ExportState;
  onApprove: () => void;
  onReject: () => void;
  onDownload: () => void;
}

export function ExportDecision({
  enabled,
  exportState,
  onApprove,
  onReject,
  onDownload,
}: ExportDecisionProps) {
  return (
    <section className="stack-card" aria-labelledby="export-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Human-controlled boundary</p>
          <h3 id="export-title">Local export packet</h3>
        </div>
        <StatusBadge tone={exportState === "approved" ? "positive" : exportState === "rejected" ? "danger" : "neutral"}>
          {exportState.toUpperCase()}
        </StatusBadge>
      </div>

      <DefinitionList
        compact
        items={[
          { term: "Includes", description: "Failure, disposition, reasons, unresolved fields, audit references and a validated result when a call occurred" },
          { term: "Excludes", description: "Direct identifiers, contact details and free-form narratives" },
          { term: "Side effect", description: "Downloads one JSON file to this device only" },
        ]}
      />

      {!enabled ? (
        <p className="empty-state">A validated result and deterministic recommendation are required first.</p>
      ) : exportState === "pending" ? (
        <div className="button-row">
          <button className="button button--primary" onClick={onApprove} type="button">
            Approve local export
          </button>
          <button className="button button--quiet" onClick={onReject} type="button">
            Reject
          </button>
        </div>
      ) : exportState === "approved" ? (
        <button className="button button--primary" onClick={onDownload} type="button">
          Download approved JSON
        </button>
      ) : (
        <p className="empty-state">Export rejected. No file was created.</p>
      )}
    </section>
  );
}
