"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import "../case-file.css";
import Link from "next/link";
type Task = {
  id: number;
  channel: string;
  summary: string;
  status: string;
  assignee: string;
  response_token: string | null;
};
export default function OtherWorkflows() {
  const caseId = useRef<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]),
    [channel, setChannel] = useState("secure_form"),
    [summary, setSummary] = useState(""),
    [assignee, setAssignee] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/workflow");
    const data = await response.json();
    if (!response.ok) throw new Error("Requests could not be loaded.");
    if (caseId.current && caseId.current !== data.session.caseId) {
      window.location.replace("/workflows");
      return;
    }
    caseId.current = data.session.caseId;
    setTasks(data.tasks);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((e) => setError(e.message));
  }, [refresh]);
  const save = async (body: unknown) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workflow", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-demo-role": "coordinator",
          "x-demo-case": caseId.current || "",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Request could not be saved.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="caseFile">
      <main className="cfMain">
        <Link href="/case-file">
          ← Return to source records and evidence review
        </Link>
        <h1>Written or human response</h1>
        <p>
          These existing Baker Street forms ask about operations before 1991 and
          use of the rear storage room. Use them only when those are the
          questions you intend to ask. Assign a person and describe why this
          response is needed.
        </p>
        <p>
          A saved request is an internal record. SiteWitness does not send email
          or messages from this page.
        </p>
        {error && (
          <p role="alert" className="cfNotice cfError">
            {error}
          </p>
        )}
        <form
          className="cfTaskForm"
          onSubmit={(event) => {
            event.preventDefault();
            void save({ action: "follow_up", channel, summary, assignee });
          }}
        >
          <label className="cfField">
            Response method
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="secure_form">Written response form</option>
              <option value="human_interview">Human interview notes</option>
            </select>
          </label>
          <label className="cfField">
            Reason and intended respondent
            <textarea
              required
              minLength={20}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <label className="cfField">
            Assigned person
            <input
              required
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            />
          </label>
          <button className="cfPrimary" disabled={busy || !loaded}>
            Prepare response request
          </button>
        </form>
        <h2>Saved requests</h2>
        {tasks.map((task) => (
          <article className="cfTask" key={task.id}>
            <h3>
              {task.channel === "secure_form"
                ? "Written response"
                : "Human interview"}{" "}
              · {task.status}
            </h3>
            <p>{task.summary}</p>
            <p>Assigned to {task.assignee}</p>
            {task.channel === "secure_form" && task.status === "READY" && (
              <button
                disabled={busy || !loaded}
                onClick={() =>
                  save({ action: "send_request", task_id: String(task.id) })
                }
              >
                Enable response link for manual sharing
              </button>
            )}
            {["SENT", "VIEWED", "SUBMITTED"].includes(task.status) &&
              task.response_token && (
                <a href={`/respond/${task.response_token}`}>
                  Open response form ↗
                </a>
              )}
            {task.channel === "human_interview" &&
              ["SCHEDULED", "IN_PROGRESS", "SUBMITTED"].includes(
                task.status,
              ) && (
                <a href={`/human-interview/${task.id}`}>
                  Open interview workspace ↗
                </a>
              )}
            {!["CANCELLED", "SUBMITTED", "DECLINED", "EXPIRED"].includes(
              task.status,
            ) && (
              <button
                disabled={busy || !loaded}
                onClick={() =>
                  save({
                    action: "cancel_request",
                    task_id: String(task.id),
                    reason: "Coordinator cancelled the response request.",
                  })
                }
              >
                Cancel request
              </button>
            )}
          </article>
        ))}
      </main>
    </div>
  );
}
