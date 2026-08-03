import { useEffect, useState } from "react";
import { api, type CallLog } from "../api";
import { StatusBadge, formatDate } from "../components";
import { CallInIcon, CallOutIcon } from "../icons";

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

const COLUMNS = "32px 1.8fr 1fr 1fr 2fr 1fr 90px";

export function CallActivityPage({ refreshKey }: { refreshKey: number }) {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.calls().then(setCalls).catch((e: Error) => setError(e.message));
  }, [refreshKey]);

  return (
    <div className="page">
      <h1>Call Activity</h1>
      <p className="page-subtitle">
        Every CALL-E invocation: the goal we sent, the structured result that came back, and the transcript. Click a
        row to expand.
      </p>
      {error !== null && <div className="error-banner">{error}</div>}

      <div className="data-grid-stacked">
        <div className="grid-head" style={{ gridTemplateColumns: COLUMNS, padding: "10px 20px", border: "1px solid var(--color-divider)" }}>
          <div />
          <div>Contact</div>
          <div>Flow</div>
          <div>Mode</div>
          <div>Goal / summary</div>
          <div>Outcome</div>
          <div style={{ textAlign: "right" }}>When</div>
        </div>
        {calls.map((call) => (
          <Row key={call.id} call={call} expanded={expanded === call.id} onToggle={() => setExpanded(expanded === call.id ? null : call.id)} />
        ))}
        {calls.length === 0 && (
          <div className="grid-row" style={{ gridTemplateColumns: "1fr" }}>
            <span className="text-muted">No calls yet — trigger a flow from Appointments or Leads.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ call, expanded, onToggle }: { call: CallLog; expanded: boolean; onToggle: () => void }) {
  const transcript: TranscriptTurn[] = call.transcript ? (JSON.parse(call.transcript) as TranscriptTurn[]) : [];
  const contactName = transcript[0]?.speaker === "bot" ? extractName(call.task) : extractName(call.task);

  return (
    <>
      <div className="grid-row" style={{ gridTemplateColumns: COLUMNS, cursor: "pointer", padding: "15px 20px" }} onClick={onToggle}>
        <div style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-accent-700)" }}>
          {call.flow === "QUALIFY" ? <CallInIcon /> : <CallOutIcon />}
        </div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{contactName}</div>
        <div style={{ fontSize: 12.5 }} className="text-muted">
          {FLOW_LABELS[call.flow] ?? call.flow}
        </div>
        <div>
          <span className={`tag ${call.dryRun ? "tag-outline" : "tag-accent"}`}>{call.dryRun ? "dry run" : "LIVE"}</span>
        </div>
        <div style={{ fontSize: 12.5, fontStyle: "italic" }} className="text-muted">
          {call.summary ?? "—"}
        </div>
        <div>
          <StatusBadge status={call.status} />
        </div>
        <div style={{ fontSize: 12.5, textAlign: "right" }} className="text-muted">
          {formatDate(call.createdAt)}
        </div>
      </div>
      {expanded && (
        <div className="expand-panel">
          <p style={{ marginBottom: 6, fontWeight: 700, fontSize: 13 }}>Goal sent to CALL-E</p>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
            {call.task}
          </p>
          <p style={{ marginBottom: 6, fontWeight: 700, fontSize: 13 }}>Structured result</p>
          <div className="result-json">{call.structuredResult ?? "null"}</div>
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
            <p className="mono text-muted" style={{ marginTop: 10, marginBottom: 0 }}>
              CALL-E call id: {call.calleCallId}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function extractName(task: string): string {
  const match = /reach ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/.exec(task) ?? /follow up with ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/.exec(task);
  return match?.[1] ?? "Unknown";
}
