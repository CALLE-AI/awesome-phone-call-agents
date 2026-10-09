"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { DemoSession } from "../lib/demo-session";
import type { CaseCoverage } from "../lib/case-coverage";
import type { PublicContact, SourceTask } from "../lib/case-file";
import "../case-file.css";

type ArchivedRun = {
  id: number;
  status: string;
  contactName: string;
  provider: string;
  recordedAt: string;
  turns: Array<{ id: string; speaker: string; text: string }>;
};
type Snapshot = {
  runs: ArchivedRun[];
  statements: Array<{
    id: string;
    fact: string;
    evidence: string;
    status: string;
  }>;
  coverage: CaseCoverage;
  caseFile?: { contacts: PublicContact[]; tasks: SourceTask[] };
  workflow?: {
    dispositions: Array<{ id: number; disposition: string; rationale: string }>;
    tasks: Array<{ id: number; summary: string; status: string }>;
  };
};

export default function CallHistory() {
  const [sessions, setSessions] = useState<DemoSession[]>([]);
  const [selected, setSelected] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/demo-session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Demo history could not be loaded.");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setSessions(data.archived);
        setSelected(data.archived[0]?.caseId || "");
        setReady(true);
      })
      .catch((problem) => {
        if (active) setError(problem.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    fetch(
      `/api/case-evidence?archive=1${selected ? `&case=${encodeURIComponent(selected)}` : ""}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "This earlier demo could not be loaded. Refresh and try again.",
          );
        return response.json();
      })
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch((problem) => {
        if (active) setError(problem.message);
      });
    return () => {
      active = false;
    };
  }, [ready, selected]);
  return (
    <div className="caseFile">
      <main className="cfMain">
        <Link href="/" prefetch={false}>
          ← Current investigation
        </Link>
        <h1>Demo history</h1>
        <p>
          Earlier tests are saved here for review. Their calls, answers and
          reviewed years stay separate from the current demo.
        </p>
        {ready && (
          <label className="cfField cfHistorySelect">
            Choose an earlier test
            <select
              value={selected}
              onChange={(event) => {
                setSnapshot(null);
                setError("");
                setSelected(event.target.value);
              }}
            >
              {sessions.map((session, index) => (
                <option key={session.caseId} value={session.caseId}>
                  Demo {sessions.length - index} ·{" "}
                  {session.startedAt
                    ? new Date(session.startedAt).toLocaleString()
                    : "Original investigation"}
                </option>
              ))}
              <option value="">
                All earlier calls, including legacy tests
              </option>
            </select>
          </label>
        )}
        {error && (
          <p role="alert" className="cfNotice cfError">
            {error}
          </p>
        )}
        {!snapshot && !error && <p role="status">Loading saved history…</p>}
        {snapshot && (
          <>
            {selected && (
              <div className="cfHistorySummary">
                <span>
                  <strong>{snapshot.runs.length}</strong> calls
                </span>
                <span>
                  <strong>{snapshot.statements.length}</strong> evidence
                  statements
                </span>
                <span>
                  <strong>{snapshot.coverage.years.length}</strong> of 8 years
                  reviewed
                </span>
              </div>
            )}
            {!snapshot.runs.length && (
              <p>
                No calls were made in {selected ? "this test" : "earlier tests"}
                .
              </p>
            )}
            {snapshot.runs.map((run) => (
              <article className="cfPerson" key={run.id}>
                <h2>{run.contactName}</h2>
                <p>
                  {run.provider === "fake"
                    ? "Synthetic rehearsal"
                    : "CALL-E call"}{" "}
                  · {run.status} · {new Date(run.recordedAt).toLocaleString()}
                </p>
                <details>
                  <summary>Original transcript</summary>
                  {run.turns.length ? (
                    run.turns.map((turn) => (
                      <p key={turn.id}>
                        <strong>{turn.speaker}: </strong>
                        {turn.text}
                      </p>
                    ))
                  ) : (
                    <p>No transcript was returned for this call.</p>
                  )}
                </details>
              </article>
            ))}
            {selected && (
              <>
                <details className="cfDetails">
                  <summary>Saved evidence and review decisions</summary>
                  {!snapshot.statements.length && (
                    <p>No evidence was collected in this test.</p>
                  )}
                  {snapshot.statements.map((statement) => (
                    <article key={statement.id}>
                      <strong>{statement.status.replaceAll("_", " ")}</strong>
                      <p>{statement.fact}</p>
                      <blockquote>{statement.evidence}</blockquote>
                    </article>
                  ))}
                  <p>
                    Reviewed years:{" "}
                    {snapshot.coverage.years.join(", ") || "none"}.
                  </p>
                  {snapshot.workflow?.dispositions.map((item) => (
                    <article key={item.id}>
                      <strong>{item.disposition.replaceAll("_", " ")}</strong>
                      <p>{item.rationale}</p>
                    </article>
                  ))}
                </details>
                <details className="cfDetails">
                  <summary>Contacts and follow-up tasks from this test</summary>
                  {snapshot.caseFile?.contacts.map((contact) => (
                    <article key={contact.id}>
                      <strong>{contact.name}</strong>
                      <p>
                        {contact.role} · {contact.maskedPhone}
                      </p>
                      <p>{contact.source}</p>
                    </article>
                  ))}
                  {snapshot.caseFile?.tasks.map((task) => (
                    <article key={task.id}>
                      <strong>
                        {task.title} · {task.status}
                      </strong>
                      <p>{task.summary}</p>
                      <p>Assigned to {task.assignee}</p>
                    </article>
                  ))}
                  {snapshot.workflow?.tasks.map((task) => (
                    <article key={task.id}>
                      <strong>{task.status}</strong>
                      <p>{task.summary}</p>
                    </article>
                  ))}
                </details>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
