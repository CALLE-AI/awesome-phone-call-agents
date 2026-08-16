import { DefinitionList } from "./DefinitionList.js";
import { StatusBadge } from "./StatusBadge.js";

export interface BrowserCallPreview {
  digest: string;
  objective: string;
  allowedQuestions: readonly string[];
  visitWindows: Array<{ id: string; label: string; start: string; end: string }>;
  guardrails: readonly string[];
  recipient: string;
}

interface CallApprovalProps {
  preview: BrowserCallPreview;
  mode: "fake" | "live";
  approved: boolean;
  completed: boolean;
  busy: boolean;
  onApprove: () => void;
  onRun: () => void;
}

export function CallApproval({ preview, mode, approved, completed, busy, onApprove, onRun }: CallApprovalProps) {
  return (
    <section className="stack-card" aria-labelledby="approval-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Exact content-bound approval</p>
          <h3 id="approval-title">One controlled call preview</h3>
        </div>
        <StatusBadge tone={approved ? "positive" : "warning"}>
          {approved ? "APPROVED" : "APPROVAL REQUIRED"}
        </StatusBadge>
      </div>

      <DefinitionList
        compact
        items={[
          { term: "Recipient", description: preview.recipient },
          { term: "Objective", description: preview.objective },
          {
            term: "Allowed questions",
            description: preview.allowedQuestions.join(" · "),
          },
          { term: "Offered windows", description: preview.visitWindows.map((window) => window.label).join(" · ") },
          { term: "Never collect / call boundary", description: preview.guardrails.join(" ") },
          { term: "Call limit", description: "One attempt; no automatic retry" },
          { term: "Ambiguous outcome", description: "Preserve for reconciliation; never redial automatically" },
        ]}
      />

      <div className="receipt">
        <span>Receipt binds case + recipient + objective + questions + windows</span>
        <code>{approved ? preview.digest : "Created only after explicit approval"}</code>
      </div>

      <div className="invalidation-cue">
        <strong>Stale approval rule</strong>
        <span>Any edit to the case, recipient, objective, allowed questions or visit windows invalidates this receipt.</span>
      </div>

      {!approved ? (
        <button className="button button--primary" disabled={busy} onClick={onApprove} type="button">
          Approve this exact call
        </button>
      ) : (
        <button className="button button--primary" disabled={completed || busy} onClick={onRun} type="button">
          {completed ? "Result recorded — no redial" : busy ? "Running one controlled attempt…" : mode === "fake" ? "Run fake CALL-E transport" : "Start one approved live CALL-E call"}
        </button>
      )}
    </section>
  );
}
