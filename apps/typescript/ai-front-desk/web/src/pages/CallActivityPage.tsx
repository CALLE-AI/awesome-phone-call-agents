import { useEffect, useState } from "react";
import { api, type CallLog } from "../api";
import { StatusBadge, formatDate } from "../components";

interface TranscriptTurn {
  speaker: string;
  text: string;
}

const FLOW_LABELS: Record<string, string> = {
  CONFIRM: "Confirmation",
  BACKFILL: "Waitlist backfill",
  QUALIFY: "Lead qualification",
  HELLO_WORLD: "Smoke test",
};

export function CallActivityPage({ refreshKey }: { refreshKey: number }) {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.calls().then(setCalls).catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  return (
    <>
      <h2>Call Activity</h2>
      <p className="subtitle">
        Every CALL-E invocation: the goal we sent, the structured result that came back, and the transcript. Click a
        row to expand.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Flow</th>
              <th>Status</th>
              <th>Task completed</th>
              <th>Mode</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <Row
                key={call.id}
                call={call}
                expanded={expanded === call.id}
                onToggle={() => setExpanded(expanded === call.id ? null : call.id)}
              />
            ))}
            {calls.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No calls yet — trigger a flow from Appointments or Leads.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ call, expanded, onToggle }: { call: CallLog; expanded: boolean; onToggle: () => void }) {
  const transcript: TranscriptTurn[] = call.transcript ? (JSON.parse(call.transcript) as TranscriptTurn[]) : [];
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>{FLOW_LABELS[call.flow] ?? call.flow}</td>
        <td>
          <StatusBadge status={call.status} />
        </td>
        <td>{call.taskCompleted === null ? "—" : call.taskCompleted ? "✅" : "❌"}</td>
        <td>
          <span className={`badge ${call.dryRun ? "amber" : "red"}`}>{call.dryRun ? "dry run" : "LIVE"}</span>
        </td>
        <td className="muted">{formatDate(call.createdAt)}</td>
      </tr>
      {expanded && (
        <tr className="expand-row">
          <td colSpan={5}>
            <p style={{ marginTop: 0 }}>
              <strong>Goal sent to CALL-E</strong>
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              {call.task}
            </p>
            <p>
              <strong>Structured result</strong>
            </p>
            <div className="result-json">{call.structuredResult ?? "null"}</div>
            {call.summary !== null && (
              <p className="muted" style={{ fontSize: 13 }}>
                <strong>Summary:</strong> {call.summary}
              </p>
            )}
            {transcript.length > 0 && (
              <div className="transcript">
                {transcript.map((turn, index) => (
                  <div key={index} className={`turn ${turn.speaker}`}>
                    <span className="speaker">{turn.speaker}</span>
                    <div>{turn.text}</div>
                  </div>
                ))}
              </div>
            )}
            {call.calleCallId !== null && (
              <p className="mono muted" style={{ marginBottom: 0 }}>
                CALL-E call id: {call.calleCallId}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
