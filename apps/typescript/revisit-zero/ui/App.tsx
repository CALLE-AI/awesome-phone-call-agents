import { useEffect, useMemo, useState } from "react";

import type {
  Disposition,
  FailedVisitCase,
  PreCallAssessment,
  PreCallDecision,
  VisitWindow,
} from "../src/case.js";
import type { WorkflowRun } from "../src/workflow.js";
import { CallApproval, type BrowserCallPreview } from "./components/CallApproval.js";
import { CaseSelector, type CaseSelectorItem } from "./components/CaseSelector.js";
import { DefinitionList } from "./components/DefinitionList.js";
import { ExportDecision, type ExportState } from "./components/ExportDecision.js";
import { StatusBadge, type StatusTone } from "./components/StatusBadge.js";
import { Timeline, type TimelineItem } from "./components/Timeline.js";
import "./styles.css";

interface CaseSummary {
  id: string;
  serviceType: FailedVisitCase["serviceType"];
  sourceFailure: FailedVisitCase["sourceFailure"];
  recipient: string;
  visitWindows: VisitWindow[];
  assessment: PreCallAssessment;
}

interface PreviewResponse {
  assessment: PreCallAssessment;
  preview: BrowserCallPreview | null;
}

interface HealthResponse {
  ok: boolean;
  mode: "fake" | "live";
  sideEffects: string[];
}

const EXPECTED_CASE_IDS = ["MTR-2026-0042", "MTR-2026-0043", "MTR-2026-0044"] as const;

const caseSummary = (caseId: string): string => ({
  "MTR-2026-0042": "Authorised contact can resolve access",
  "MTR-2026-0043": "Access controlled by body corporate",
  "MTR-2026-0044": "Safety issue blocks automation",
} as Record<string, string>)[caseId] ?? "Failed visit exception";

const toneForGate = (gate: PreCallDecision): StatusTone =>
  gate === "ELIGIBLE_FOR_CALL" ? "positive" : gate === "AUTOMATION_BLOCKED" ? "danger" : "warning";

const toneForDisposition = (disposition: Disposition): StatusTone =>
  disposition === "READY_FOR_REBOOK_REVIEW" ? "positive"
    : disposition === "MANUAL_REVIEW" || disposition === "NOT_READY" || disposition === "UNREACHED" ? "warning"
      : "danger";

const dispositionBeforeCall = (gate: PreCallDecision): Disposition | null => {
  if (gate === "ELIGIBLE_FOR_CALL") return null;
  return gate === "MANUAL_REVIEW_REQUIRED" ? "MANUAL_REVIEW" : "AUTOMATION_BLOCKED";
};

function buildTimeline(
  assessment: PreCallAssessment,
  approved: boolean,
  run: WorkflowRun | null,
): TimelineItem[] {
  if (run) {
    return run.timeline.map((event, index) => ({
      label: ({
        POLICY: "Eligibility gate",
        APPROVAL: "Exact call approval",
        CALL_RESERVED: "One-call reservation",
        CALL_RESULT: "CALL-E result",
        RECONCILIATION: "Reconciliation required",
        DECISION: "Deterministic recommendation",
      } as const)[event.type],
      detail: event.message,
      state: event.type === "RECONCILIATION" ? "blocked" : index === run.timeline.length - 1 ? "current" : "complete",
    }));
  }
  if (assessment.decision === "AUTOMATION_BLOCKED") {
    return [
      { label: "Safety gate", detail: assessment.reasons.map((reason) => reason.message).join(" "), state: "blocked" },
      { label: "Call approval", detail: "Unavailable by policy", state: "blocked" },
      { label: "CALL-E contact", detail: "Not attempted", state: "blocked" },
    ];
  }
  if (assessment.decision !== "ELIGIBLE_FOR_CALL") {
    return [
      { label: "Eligibility gate", detail: assessment.reasons.map((reason) => reason.message).join(" "), state: "complete" },
      { label: "Manual review", detail: "Human ownership required", state: "current" },
      { label: "CALL-E contact", detail: "Not attempted", state: "blocked" },
    ];
  }
  return [
    { label: "Eligibility gate", detail: "Deterministic checks passed", state: "complete" },
    {
      label: "Exact call approval",
      detail: approved ? "Current preview digest approved" : "Operator action required",
      state: approved ? "complete" : "current",
    },
    {
      label: "One CALL-E attempt",
      detail: approved ? "Ready for the configured transport" : "Waiting for approval",
      state: approved ? "current" : "pending",
    },
    { label: "Recommendation", detail: "Not generated", state: "pending" },
  ];
}

async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json() as T | { error?: string };
  if (!response.ok) {
    const message = typeof value === "object" && value && "error" in value ? value.error : undefined;
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return value as T;
}

export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>(EXPECTED_CASE_IDS[0]);
  const [previewResponse, setPreviewResponse] = useState<PreviewResponse | null>(null);
  const [approvedDigest, setApprovedDigest] = useState<string | null>(null);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [mode, setMode] = useState<HealthResponse["mode"]>("fake");
  const [liveDispatchToken, setLiveDispatchToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<ExportState>("pending");
  const [exportPacket, setExportPacket] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/health").then((response) => readJson<HealthResponse>(response)),
      fetch("/api/cases").then((response) => readJson<CaseSummary[]>(response)),
    ]).then(([health, loadedCases]) => {
      if (!active) return;
      const orderedCases = EXPECTED_CASE_IDS
        .map((caseId) => loadedCases.find((item) => item.id === caseId))
        .filter((item): item is CaseSummary => Boolean(item));
      setMode(health.mode);
      setCases(orderedCases);
      if (orderedCases[0]) setSelectedId(orderedCases[0].id);
    }).catch((requestError: unknown) => {
      if (active) setError(requestError instanceof Error ? requestError.message : "Unable to load demo cases");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId || !cases.some((item) => item.id === selectedId)) return;
    let active = true;
    setPreviewResponse(null);
    setApprovedDigest(null);
    setRun(null);
    setLiveDispatchToken("");
    setExportState("pending");
    setExportPacket(null);
    setError(null);
    fetch(`/api/cases/${encodeURIComponent(selectedId)}/preview`, { method: "POST" })
      .then((response) => readJson<PreviewResponse>(response))
      .then((value) => { if (active) setPreviewResponse(value); })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Unable to load call preview");
      });
    return () => { active = false; };
  }, [cases, selectedId]);

  const selectedCase = cases.find((item) => item.id === selectedId) ?? null;
  const assessment = previewResponse?.assessment ?? selectedCase?.assessment ?? null;
  const preview = previewResponse?.preview ?? null;
  const approved = Boolean(preview && approvedDigest === preview.digest);
  const shownDisposition = run?.disposition ?? (assessment ? dispositionBeforeCall(assessment.decision) : null);
  const decisionReasons = run?.decisionReasons ?? assessment?.reasons ?? [];
  const unresolvedFields = run?.unresolvedFields ?? (
    assessment?.decision === "MANUAL_REVIEW_REQUIRED" ? ["Access authority"] : []
  );

  const selectorCases: CaseSelectorItem[] = cases.map((item) => ({
    id: item.id,
    label: item.id,
    summary: caseSummary(item.id),
    gateLabel: item.assessment.decision,
    gateTone: toneForGate(item.assessment.decision),
  }));

  const timeline = useMemo(
    () => assessment ? buildTimeline(assessment, approved, run) : [],
    [assessment, approved, run],
  );

  const executeCall = async () => {
    if (!selectedCase || !preview || !approvedDigest) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(selectedCase.id)}/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(mode === "live" ? { Authorization: `Bearer ${liveDispatchToken}` } : {}),
        },
        body: JSON.stringify({ previewDigest: approvedDigest }),
      });
      setRun(await readJson<WorkflowRun>(response));
      setLiveDispatchToken("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The controlled call workflow failed");
    } finally {
      setBusy(false);
    }
  };

  const decideExport = async (decision: "APPROVE" | "REJECT") => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(run.caseId)}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, decidedBy: "demo-operator" }),
      });
      const packet = await readJson<unknown>(response);
      if (decision === "APPROVE") {
        setExportPacket(packet);
        setExportState("approved");
      } else {
        setExportPacket(null);
        setExportState("rejected");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The export decision failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadPacket = () => {
    if (!run || !exportPacket) return;
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(exportPacket, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `revisit-zero-${run.caseId}-approved.json`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  if (!selectedCase || !assessment) {
    return (
      <main className="app-shell app-shell--loading">
        <div className="empty-state" role={error ? "alert" : "status"}>
          <strong>{error ? "Unable to load RevisitZero" : "Loading fictional demo cases…"}</strong>
          {error && <span>{error}</span>}
        </div>
      </main>
    );
  }

  const selectedWindow = run?.structuredResult?.selectedVisitWindowId
    ? selectedCase.visitWindows.find((window) => window.id === run.structuredResult?.selectedVisitWindowId)?.label ?? run.structuredResult.selectedVisitWindowId
    : "None selected";

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="product-kicker">RevisitZero · Meter Access Recovery</p>
          <h1>One failed visit. One controlled call. One trustworthy rebook decision.</h1>
        </div>
        <div className={`mode-card mode-card--${mode}`} aria-label="Current operating mode">
          <span className="mode-card__pulse" aria-hidden="true" />
          <div>
            <strong>{mode === "fake" ? "FAKE / NO-CALL DEMO" : "CONTROLLED LIVE MODE"}</strong>
            <span>{mode === "fake" ? "Fictional data · no external side effects" : "One explicitly approved test call only"}</span>
          </div>
        </div>
      </header>

      <section className="scope-strip" aria-label="Workflow boundary">
        <strong>Stops at an approved local export packet.</strong>
        <span>No booking</span><span>No CRM update</span><span>No customer notification</span><span>No automatic retry</span>
      </section>

      <CaseSelector cases={selectorCases} onSelect={setSelectedId} selectedId={selectedId} />

      {error && <div className="error-banner" role="alert">{error}</div>}

      <section aria-labelledby={`case-tab-${selectedCase.id}`} className="workbench" id="case-workbench" role="tabpanel">
        <article className="workbench__column" aria-labelledby="failed-visit-title">
          <div className="column-heading">
            <span className="step-number">1</span>
            <div><p className="eyebrow">Source evidence</p><h2 id="failed-visit-title">Failed visit</h2></div>
          </div>

          <section className="stack-card stack-card--emphasis">
            <div className="section-heading">
              <div><p className="eyebrow">{selectedCase.id}</p><h3>Smart-meter replacement</h3></div>
              <StatusBadge tone="info">FICTIONAL</StatusBadge>
            </div>
            <p className="failure-copy">{selectedCase.sourceFailure.summary}</p>
            <DefinitionList items={[
              { term: "Recipient", description: selectedCase.recipient },
              { term: "Offered windows", description: selectedCase.visitWindows.map((window) => window.label).join(" · ") || "None" },
              { term: "Attempts used", description: run?.callId || run?.idempotencyReference ? "1 of 1" : "0 of 1" },
            ]} />
          </section>

          <section className="stack-card">
            <div className="section-heading">
              <div><p className="eyebrow">Deterministic policy</p><h3>Pre-call gate</h3></div>
              <StatusBadge tone={toneForGate(assessment.decision)}>{assessment.decision}</StatusBadge>
            </div>
            {assessment.reasons.map((reason) => <p key={reason.code}>{reason.message}</p>)}
            <p className="helper-text">No model is used for eligibility or safety decisions.</p>
          </section>
        </article>

        <article className="workbench__column" aria-labelledby="call-control-title">
          <div className="column-heading">
            <span className="step-number">2</span>
            <div><p className="eyebrow">Controlled contact</p><h2 id="call-control-title">Call control & timeline</h2></div>
          </div>

          <section className="stack-card"><h3 className="visually-hidden">Workflow timeline</h3><Timeline items={timeline} /></section>

          {preview ? (
            <CallApproval
              approved={approved}
              busy={busy}
              completed={Boolean(run)}
              liveDispatchToken={liveDispatchToken}
              mode={mode}
              onApprove={() => setApprovedDigest(preview.digest)}
              onLiveDispatchTokenChange={setLiveDispatchToken}
              onRun={() => { void executeCall(); }}
              preview={preview}
            />
          ) : (
            <section className="stack-card stack-card--locked">
              <StatusBadge tone={assessment.decision === "AUTOMATION_BLOCKED" ? "danger" : "warning"}>NO CALL</StatusBadge>
              <h3>{assessment.decision === "AUTOMATION_BLOCKED" ? "Automation stopped safely" : "Operator review required"}</h3>
              <p>{assessment.reasons.map((reason) => reason.message).join(" ")}</p>
              <button className="button button--primary" disabled type="button">Call unavailable</button>
            </section>
          )}

          {run?.structuredResult && (
            <section className="stack-card" aria-live="polite">
              <div className="section-heading">
                <div><p className="eyebrow">Closed structured result</p><h3>Schema valid · no contradictions</h3></div>
                <StatusBadge tone="positive">VALIDATED</StatusBadge>
              </div>
              <DefinitionList compact items={[
                { term: "Gate access", description: run.structuredResult.accessResolution.gateUnlocked },
                { term: "Dog secured", description: run.structuredResult.accessResolution.dogSecured },
                { term: "Obstruction", description: run.structuredResult.accessResolution.obstructionRemoved },
                { term: "Presence", description: run.structuredResult.accessResolution.presenceArranged },
                { term: "Window", description: selectedWindow },
                { term: "Opt-out", description: run.structuredResult.optOut ? "YES · suppression recorded" : "NO" },
                { term: "Reconciliation", description: run.reconciliationPending ? "Required · no redial" : "Not required" },
              ]} />
              <div className="receipt"><span>Call / idempotency</span><code>{run.callId ?? "No call ID"} · {run.idempotencyReference ?? "No reference"}</code></div>
            </section>
          )}
        </article>

        <article className="workbench__column" aria-labelledby="decision-title">
          <div className="column-heading">
            <span className="step-number">3</span>
            <div><p className="eyebrow">Human review boundary</p><h2 id="decision-title">Decision & export</h2></div>
          </div>

          <section className="stack-card stack-card--decision" aria-live="polite">
            <p className="eyebrow">Deterministic disposition</p>
            {shownDisposition ? (
              <>
                <StatusBadge tone={toneForDisposition(shownDisposition)}>{shownDisposition}</StatusBadge>
                <h3>{decisionReasons.map((reason) => reason.message).join(" ")}</h3>
                <DefinitionList compact items={[
                  { term: "Unresolved", description: unresolvedFields.length ? unresolvedFields.join(" · ") : "None" },
                  { term: "Recipient", description: run?.maskedRecipient ?? selectedCase.recipient },
                  { term: "Call approval", description: run?.approvalState ?? "NOT_REQUIRED" },
                  { term: "Call ID", description: run?.callId ?? "Not created · no call confirmed" },
                  { term: "Idempotency", description: run?.idempotencyReference ?? "Not created · no call reserved" },
                  { term: "Reconciliation", description: run?.reconciliationPending ? "PENDING · automatic redial prohibited" : "Not required" },
                ]} />
              </>
            ) : (
              <div className="empty-state"><strong>No recommendation yet</strong><span>Complete the exact approved workflow to produce one.</span></div>
            )}
          </section>

          {run?.exportState === "PENDING_HUMAN_APPROVAL" ? (
            <ExportDecision
              enabled
              exportState={exportState}
              onApprove={() => { void decideExport("APPROVE"); }}
              onDownload={downloadPacket}
              onReject={() => { void decideExport("REJECT"); }}
            />
          ) : (
            <section className="stack-card">
              <p className="eyebrow">Next action</p>
              <h3>{shownDisposition ? "Route through the appropriate human process" : "Await the validated result"}</h3>
              <p>{shownDisposition ? "RevisitZero takes no external action for this disposition." : "No export is available before strict validation and a deterministic recommendation."}</p>
            </section>
          )}
        </article>
      </section>

      <footer className="app-footer">
        <span>Demo dataset: {cases.length} of 3 fictional cases</span>
        <span>English-only desktop operator workbench</span>
        <span>RevisitZero does not diagnose, book or notify</span>
      </footer>
    </main>
  );
}
