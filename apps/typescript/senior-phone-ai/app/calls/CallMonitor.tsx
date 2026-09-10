"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { assertCalleCallId, type CalleCallSnapshot } from "@/lib/calle/status";

const POLL_INTERVAL_MS = 2_000;

async function loadSnapshot(callId: string, signal: AbortSignal): Promise<CalleCallSnapshot> {
  const response = await fetch("/api/calls/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Call status is unavailable");
  return response.json() as Promise<CalleCallSnapshot>;
}

export function CallMonitor() {
  const [callId, setCallId] = useState("");
  const [monitoredCallId, setMonitoredCallId] = useState<string>();
  const [monitorVersion, setMonitorVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<CalleCallSnapshot>();
  const [error, setError] = useState<string>();
  const requestRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    if (!monitoredCallId) return;
    let active = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const next = await loadSnapshot(monitoredCallId, controller.signal);
        if (!active) return;
        failures = 0;
        setSnapshot(next);
        setError(undefined);
        if (next.status === "queued" || next.status === "in_progress" || next.status === "unknown") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        failures += 1;
        setError(cause instanceof Error ? cause.message : "Call status is unavailable");
        if (failures < 3) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [monitoredCallId, monitorVersion]);

  const startMonitoring = () => {
    try {
      const validated = assertCalleCallId(callId.trim());
      setSnapshot(undefined);
      setError(undefined);
      setMonitoredCallId(validated);
      setMonitorVersion((version) => version + 1);
    } catch {
      setError("Enter the CALL-E ID returned when the call was created.");
    }
  };

  return (
    <main className="monitor-page">
      <nav aria-label="Product">
        <Link className="brand" href="/">Senior Phone AI</Link>
        <span className="mode">local operator view</span>
      </nav>
      <section className="monitor-card" aria-labelledby="monitor-heading">
        <p className="eyebrow">Live call visibility</p>
        <h1 id="monitor-heading">Phone conversation monitor</h1>
        <p className="lede">
          Enter the CALL-E call ID to follow its status and display transcript turns as the provider
          publishes them. CALL-E may withhold transcript text until the call has finished.
        </p>
        <div className="monitor-form">
          <label htmlFor="call-id">CALL-E call ID</label>
          <input
            autoComplete="off"
            id="call-id"
            onChange={(event) => setCallId(event.target.value)}
            placeholder="call_…"
            spellCheck={false}
            value={callId}
          />
          <button onClick={startMonitoring} type="button">Monitor call</button>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </section>

      <section className="notes-card monitor-transcript" aria-labelledby="phone-transcript-heading">
        <div className="monitor-status-row">
          <div>
            <p className="eyebrow">Operator review</p>
            <h2 id="phone-transcript-heading">Live phone transcript</h2>
          </div>
          <strong className="status-pill" aria-live="polite">{snapshot?.status ?? "not monitoring"}</strong>
        </div>
        {snapshot?.transcript.length ? (
          <div className="conversation-list" aria-live="polite">
            {snapshot.transcript.map((turn) => (
              <article className={`conversation-note note-${turn.speaker}`} key={turn.id}>
                <strong>{turn.speaker === "caller" ? "Caller" : "Senior Phone AI"}</strong>
                <small>{turn.offsetSeconds}s</small>
                <p>{turn.text}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-transcript">
            {monitoredCallId
              ? "Waiting for CALL-E to publish conversation text. Call status will continue updating."
              : "No call is being monitored."}
          </p>
        )}
        {snapshot?.summary ? <p className="call-summary"><strong>Provider summary:</strong> {snapshot.summary}</p> : null}
        <p className="fine-print">
          This local view keeps transcript text in memory only, masks phone-like text, and never
          exposes the CALL-E API key to the browser.
        </p>
      </section>
    </main>
  );
}
