"use client";
import { redactText } from "./lib/output-privacy";
/* eslint-disable jsx-a11y/no-noninteractive-element-to-interactive-role */

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type Review = "pending" | "accepted" | "edited" | "rejected" | "follow_up";
type Statement = {
  id: string;
  fact: string;
  source: string;
  certainty: string;
  evidence: string;
  turn: number;
  status: Review;
  warning?: string;
  blocking?: boolean;
  limitations?: string[];
  revision?: number;
  origin?: "secure_form" | "human_interview" | "fake" | "calle_goal" | "calle_calls";
};
type Props = {
  statements: Statement[];
  setStatements: Dispatch<SetStateAction<Statement[]>>;
  transcript: string[][];
  transcriptLabel: string;
  transcriptEmptyMessage: string;
  providerMode: "fake" | "calle_goal" | "calle_calls";
  selected: string;
  setSelected: (id: string) => void;
  role: string;
  counts: { accepted: number; pending: number };
  onDispositionSaved: (
    value: { disposition: string; rationale: string; at: string } | null,
  ) => void;
  workflow: { status: string; assigned_role: string; next_action: string };
  onWorkflowChanged: (value: { status: string; assigned_role: string; next_action: string }) => void;
};
const defaultRationale =
  "";

export default function AdvancedReview(p: Props) {
  const updateStatements = p.setStatements;
  const notifyDisposition = p.onDispositionSaved;
  const [editing, setEditing] = useState<Statement | null>(null);
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState("");
  const [certainty, setCertainty] = useState("");
  const [limitations, setLimitations] = useState("");
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState("PARTIALLY_RESOLVED");
  const [rationale, setRationale] = useState(defaultRationale);
  const [saved, setSaved] = useState<{
    disposition: string;
    rationale: string;
    at: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const current = p.statements.find((s) => s.id === p.selected)!;
  const canReview = p.role === "reviewer" && p.workflow.assigned_role === "reviewer";
  const reviewed = useMemo(
    () => p.statements.filter((s) => s.status !== "pending").length,
    [p.statements],
  );
  const dispositionIsCurrent = Boolean(
    saved &&
    saved.disposition === disposition &&
    saved.rationale === rationale.trim(),
  );
  useEffect(() => {
    let active = true;
    fetch("/api/workflow")
      .then((response) => response.json())
      .then(
        (data: {
          reviews?: Array<{
            statement_id: string;
            action: Review | "edit";
            expected_revision: number;
            payload: string;
          }>;
          dispositions?: Array<{
            disposition: string;
            rationale: string;
            created_at: string;
          }>;
          ingested_statements?: Array<{
            id: string; origin: "secure_form" | "human_interview" | "fake" | "calle_goal" | "calle_calls"; fact: string; source: string; certainty: string;
            evidence: string; limitations: string;
          }>;
        }) => {
          if (!active) return;
          const reviews = [...(data.reviews || [])].reverse();
          updateStatements((items) => {
            const incoming: Statement[] = (data.ingested_statements || []).map((item) => ({
              ...item, turn: 0, status: "pending", limitations: item.limitations ? [item.limitations] : [],
            }));
            const retained = p.providerMode !== "fake"
              ? items.filter((item) => item.origin === "calle_goal" || item.origin === "calle_calls")
              : items.filter((item) => !item.origin);
            const relevantIncoming = p.providerMode !== "fake"
              ? incoming.filter((item) => item.origin === "calle_goal" || item.origin === "calle_calls")
              : incoming.filter((item) => item.origin !== "calle_goal" && item.origin !== "calle_calls");
            const merged = [...new Map(
              [...retained, ...relevantIncoming].map((item) => [item.id, item]),
            ).values()];
            return merged.map((item) => {
                const actions = reviews.filter(
                  (review) => review.statement_id === item.id,
                );
                return actions.reduce((current, action) => {
                  const payload =
                    typeof action.payload === "string"
                      ? (JSON.parse(action.payload) as Partial<Statement>)
                      : action.payload;
                  return {
                    ...current,
                    ...payload,
                    status: action.action === "edit" ? "edited" : action.action,
                    revision: action.expected_revision + 1,
                  } as Statement;
                }, item);
              });
          });
          const latest = data.dispositions?.[0];
          if (latest) {
            const restored = {
              disposition: latest.disposition,
              rationale: latest.rationale,
              at: new Date(latest.created_at).toLocaleString(),
            };
            setSaved(restored);
            notifyDisposition(restored);
          }
        },
      )
      .catch(() =>
        setMessage(
          "Saved review history is temporarily unavailable; current changes remain visible.",
        ),
      );
    return () => {
      active = false;
    };
  }, [notifyDisposition, p.providerMode, updateStatements]);
  const persist = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/workflow", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-role": p.role },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: { message: string } };
    if (!response.ok)
      throw new Error(data.error?.message || "The action could not be saved.");
    return data;
  };
  const act = async (statement: Statement, status: Review) => {
    if (!canReview) {
      setMessage("This case must be assigned to the EP review queue before evidence decisions can be saved.");
      return;
    }
    if (statement.blocking && status !== "rejected" && status !== "follow_up") {
      setMessage(
        "Resolve or reject the blocking warning before accepting this statement.",
      );
      return;
    }
    try {
      await persist({
        action: "review",
        statement_id: statement.id,
        status,
        expected_revision: statement.revision || 1,
        note: `Reviewer selected ${status}.`,
      });
      p.setStatements((xs) =>
        xs.map((s) =>
          s.id === statement.id
            ? { ...s, status, revision: (s.revision || 1) + 1 }
            : s,
        ),
      );
      setMessage(
        `${statement.id} marked ${status.replace("_", " ")}. Audit history recorded.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Review failed.");
    }
  };
  const openEdit = (s: Statement) => {
    setEditing(s);
    setDraft(s.fact);
    setSource(s.source);
    setCertainty(s.certainty);
    setLimitations((s.limitations || []).join("; "));
    setNote("");
  };
  const saveEdit = async () => {
    if (!editing || draft.trim().length < 12 || note.trim().length < 5) {
      setMessage("Provide supported wording and a short reviewer note.");
      return;
    }
    try {
      await persist({
        action: "edit",
        statement_id: editing.id,
        expected_revision: editing.revision || 1,
        fact: draft.trim(),
        source,
        certainty,
        limitations: limitations
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean),
        note: note.trim(),
      });
      p.setStatements((xs) =>
        xs.map((s) =>
          s.id === editing.id
            ? {
                ...s,
                fact: draft.trim(),
                source,
                certainty,
                limitations: limitations
                  .split(";")
                  .map((x) => x.trim())
                  .filter(Boolean),
                status: "edited",
                revision: (s.revision || 1) + 1,
              }
            : s,
        ),
      );
      setEditing(null);
      setMessage(
        `${editing.id} revision saved. Its transcript evidence was preserved.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Edit failed.");
    }
  };
  const saveDisposition = async () => {
    if (rationale.trim().length < 20) {
      setMessage(
        "A specific reviewer rationale of at least 20 characters is required.",
      );
      return;
    }
    try {
      await persist({
        action: "disposition",
        disposition,
        rationale: rationale.trim(),
      });
      const savedDisposition = {
        disposition,
        rationale: rationale.trim(),
        at: new Date().toLocaleString(),
      };
      setSaved(savedDisposition);
      notifyDisposition(savedDisposition);
      const resolved = disposition === "RESOLVED_BY_REVIEWER";
      p.onWorkflowChanged({
        status: resolved ? "RESOLVED" : "FOLLOW_UP_REQUIRED",
        assigned_role: resolved ? "none" : "coordinator",
        next_action: resolved
          ? "No further workflow action is required."
          : "Create and manage the follow-up requested by the EP Reviewer.",
      });
      setMessage(
        "Human disposition saved. Property and portfolio workflow status updated.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Disposition failed.");
    }
  };
  const download = (format: "json" | "markdown") => {
    const accepted = p.statements.filter(
      (s) => s.status === "accepted" || s.status === "edited",
    );
    const disclaimer =
      "This packet contains factual interview evidence and human review status. It does not contain an environmental conclusion, liability determination, or recommendation regarding further investigation.";
    const value =
      format === "json"
        ? JSON.stringify(
            {
              property: "47 Baker Street",
              interview_id: "INT-001",
              disclaimer,
              disposition: saved,
              statements: accepted.map((s) => ({
                ...s,
                evidence_turn: s.turn,
              })),
            },
            null,
            2,
          )
        : `# SiteWitness evidence packet\n\n${disclaimer}\n\n## Human disposition\n\n${saved ? `${saved.disposition}: ${saved.rationale}` : "Not yet saved."}\n\n## Reviewed factual statements\n\n${accepted.map((s) => `- **${s.id}** ${s.fact}\n  - Source: ${s.source}; certainty: ${s.certainty}\n  - Evidence: respondent transcript turn ${s.turn}`).join("\n") || "No statements have been accepted or edited."}`;
    const blob = new Blob([redactText(value)], {
      type: format === "json" ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sitewitness-47-baker-evidence.${format === "json" ? "json" : "md"}`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(`${format.toUpperCase()} evidence packet exported.`);
  };
  return (
    <main className="reviewPage">
      <div className="reviewHead">
        <div>
          <p className="eyebrow">47 BAKER STREET · INTERVIEW INT-001</p>
          <h1>Evidence review</h1>
          <p>
            Generated statements remain pending until an Environmental
            Professional acts.
          </p>
        </div>
        <div className="reviewMetrics">
          <span>
            <strong>{reviewed}</strong>Reviewed
          </span>
          <span>
            <strong>{p.counts.pending}</strong>Pending
          </span>
        </div>
      </div>
      {message && (
        <div className="reviewNotice" role="status">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
      <div className={`reviewAssignment ${p.workflow.assigned_role === "reviewer" ? "actionable" : "readOnly"}`}>
        <div><span>Workflow state</span><strong>{p.workflow.status.replaceAll("_", " ")}</strong></div>
        <p>{p.workflow.next_action}</p>
        <b>{p.workflow.assigned_role === "reviewer" ? "EP review action required" : "Read-only until evidence is assigned to EP review"}</b>
      </div>
      {saved && (
        <div className="dispositionSaved">
          <span>Human disposition</span>
          <strong>{saved.disposition.replaceAll("_", " ")}</strong>
          <small>
            Saved {saved.at}. This is a factual workflow status, not an
            environmental conclusion.
          </small>
        </div>
      )}
      <div className="reviewGrid">
        <section className="transcript">
          <div className="stickyTitle">
            <strong>Transcript</strong>
            <span>{p.transcriptLabel}</span>
          </div>
          {p.transcript.length === 0 && (
            <div className="reviewNotice" role="status">
              {p.transcriptEmptyMessage}
            </div>
          )}
          {p.transcript.map((t, i) => (
            <article
              id={`turn-${i + 1}`}
              className={`${t[0] === "Morgan Lee" || t[0] === "Respondent" ? "respondentTurn" : "agentTurn"} ${current?.turn === i + 1 ? "highlight" : ""}`}
              key={i}
            >
              <div>
                <strong>{t[0]}</strong>
                <small>Turn {i + 1}</small>
              </div>
              <p>{t[1]}</p>
            </article>
          ))}
        </section>
        <section className="statements">
          <div className="stickyTitle">
            <strong>Structured statements</strong>
            <span>Evidence-linked · Human review required</span>
          </div>
          {p.statements.length === 0 && (
            <div className="reviewNotice" role="status">
              No reviewable factual statements were returned. The case has been routed for coordinator follow-up rather than presenting synthetic evidence as call evidence.
            </div>
          )}
          {p.statements.map((s) => (
            <article
              className={`statement ${p.selected === s.id ? "selectedStatement" : ""}`}
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => p.setSelected(s.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  p.setSelected(s.id);
              }}
            >
              <div className="statementTop">
                <span>
                  {s.id} · REV {s.revision || 1}
                </span>
                <b className={`reviewStatus ${s.status}`}>
                  {s.status.replace("_", " ")}
                </b>
              </div>
              <p>{s.fact}</p>
              <div className="tags">
                <span>{s.source}</span>
                <span>{s.certainty}</span>
                {s.limitations?.map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              {s.origin ? (
                <div className="secureEvidence">
                  <strong>{s.origin === "secure_form" ? "Secure form" : s.origin === "calle_goal" || s.origin === "calle_calls" ? "CALL-E supporting quote" : "Human interview"} · Original answer</strong>
                  <p>“{s.evidence}”</p>
                </div>
              ) : (
                <a className="evidenceLink" href={`#turn-${s.turn}`} onClick={() => p.setSelected(s.id)}>
                  ↗ Transcript turn {s.turn}
                </a>
              )}
              {s.warning && (
                <div className={`warning ${s.blocking ? "block" : ""}`}>
                  <strong>
                    {s.blocking ? "Blocking warning" : "Review warning"}
                  </strong>
                  {s.warning}
                </div>
              )}
              <div className="reviewActions">
                <button
                  disabled={!canReview || s.blocking}
                  onClick={() => act(s, "accepted")}
                >
                  Accept
                </button>
                <button
                  disabled={!canReview || s.blocking}
                  onClick={() => openEdit(s)}
                >
                  Edit
                </button>
                <button
                  disabled={!canReview}
                  onClick={() => act(s, "rejected")}
                >
                  Reject
                </button>
                <button
                  disabled={!canReview}
                  onClick={() => act(s, "follow_up")}
                >
                  Follow up
                </button>
              </div>
            </article>
          ))}
          <section className="packet">
            <p className="panelLabel">EVIDENCE GAP DISPOSITION</p>
            <label>
              Disposition
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
                disabled={!canReview}
              >
                <option value="PARTIALLY_RESOLVED">Partially resolved</option>
                <option value="REMAINS_UNRESOLVED">Remains unresolved</option>
                <option value="HUMAN_INTERVIEW_REQUIRED">
                  Human interview required
                </option>
                <option value="ADDITIONAL_RECORD_REQUIRED">
                  Additional record required
                </option>
                <option value="RESOLVED_BY_REVIEWER">
                  Resolved by reviewer
                </option>
              </select>
            </label>
            <label>
              Required rationale
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                disabled={!canReview}
              />
            </label>
            <div className="dispositionActionRow">
              <button
                className={`primary inline ${dispositionIsCurrent ? "savedAction" : ""}`}
                disabled={!canReview || dispositionIsCurrent}
                onClick={saveDisposition}
              >
                {dispositionIsCurrent
                  ? "✓ Disposition saved"
                  : saved
                    ? "Save disposition changes"
                    : "Save human disposition"}
              </button>
              {saved && (
                <div className="inlineSaveConfirmation" role="status">
                  <strong>Saved successfully</strong>
                  <span>{saved.disposition.replaceAll("_", " ")}</span>
                  <small>{saved.at}</small>
                </div>
              )}
            </div>
            <small>
              This is a workflow disposition, not an environmental conclusion.
            </small>
            <div className="exportActions">
              <button onClick={() => download("json")}>Export JSON</button>
              <button onClick={() => download("markdown")}>
                Export Markdown
              </button>
            </div>
          </section>
        </section>
      </div>
      {editing && (
        <div className="modalBackdrop" role="presentation">
          <section
            className="editModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <div className="modalHead">
              <div>
                <p className="eyebrow">STATEMENT REVISION</p>
                <h2 id="edit-title">Edit {editing.id}</h2>
              </div>
              <button
                aria-label="Close editor"
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </div>
            <label>
              Normalized factual wording
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <div className="editPair">
              <label>
                Source type
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option>Direct observation</option>
                  <option>Personal action</option>
                  <option>Hearsay</option>
                  <option>Assumption</option>
                  <option>Document reference</option>
                  <option>Unknown</option>
                  <option>Knowledge limitation</option>
                </select>
              </label>
              <label>
                Certainty
                <select
                  value={certainty}
                  onChange={(e) => setCertainty(e.target.value)}
                >
                  <option>Confirmed</option>
                  <option>Probable</option>
                  <option>Uncertain</option>
                  <option>Not known</option>
                </select>
              </label>
            </div>
            <label>
              Limitations <small>Separate multiple items with semicolons</small>
              <input
                value={limitations}
                onChange={(e) => setLimitations(e.target.value)}
              />
            </label>
            <label>
              Reviewer note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Explain why this revision remains faithful to the evidence."
              />
            </label>
            <div className="evidencePreview">
              <strong>Immutable evidence · {editing.origin ? (editing.origin === "secure_form" ? "Secure form answer" : "Human interview answer") : `Turn ${editing.turn}`}</strong>
              <p>“{editing.evidence}”</p>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary inline" onClick={saveEdit}>
                Save revision
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
