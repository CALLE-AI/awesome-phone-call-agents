"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CalleCallSnapshot } from "@/lib/calle/status";

const POLL_INTERVAL_MS = 2_000;

interface CallListResponse {
  readonly calls: CalleCallSnapshot[];
  readonly unavailableCount: number;
}

async function loadCalls(signal: AbortSignal): Promise<CallListResponse> {
  const response = await fetch("/api/calls/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Call status is unavailable");
  return response.json() as Promise<CallListResponse>;
}

export function CallMonitor() {
  const [calls, setCalls] = useState<CalleCallSnapshot[]>([]);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [error, setError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestRef = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    let active = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const result = await loadCalls(controller.signal);
        if (!active) return;
        failures = 0;
        setCalls(result.calls);
        setUnavailableCount(result.unavailableCount);
        setError(undefined);
        if (result.calls.some((call) => ["queued", "in_progress", "unknown"].includes(call.status))) {
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
  }, [refreshVersion]);

  return (
    <main className="monitor-page">
      <nav aria-label="Product">
        <Link className="brand" href="/">Senior Phone AI</Link>
        <span className="mode">local operator view</span>
      </nav>
      <section className="monitor-card" aria-labelledby="monitor-heading">
        <p className="eyebrow">Live call visibility</p>
        <h1 id="monitor-heading">Phone conversations</h1>
        <p className="lede">
          Calls registered by this application appear automatically. Active rows refresh every two
          seconds and show transcript turns as CALL-E publishes them.
        </p>
        <button onClick={refresh} type="button">Refresh table</button>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {unavailableCount ? (
          <p className="error" role="status">{unavailableCount} registered call could not be refreshed.</p>
        ) : null}
      </section>

      <section className="notes-card monitor-transcript" aria-labelledby="phone-transcript-heading">
        <div className="monitor-status-row">
          <div>
            <p className="eyebrow">Operator review</p>
            <h2 id="phone-transcript-heading">All monitored calls</h2>
          </div>
          <strong className="status-pill" aria-live="polite">{calls.length} calls</strong>
        </div>
        {calls.length ? (
          <div className="call-table-wrap">
            <table className="call-table">
              <thead>
                <tr><th>Started</th><th>Call</th><th>Status</th><th>Conversation</th><th>Summary</th></tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.callId}>
                    <td>{call.createdAt ? new Date(call.createdAt).toLocaleString() : "Pending"}</td>
                    <td><code>{call.callId}</code></td>
                    <td><strong className="status-pill">{call.status}</strong></td>
                    <td>
                      {call.transcript.length ? (
                        <details>
                          <summary>{call.transcript.length} transcript turns</summary>
                          <div className="table-conversation">
                            {call.transcript.map((turn) => (
                              <p key={turn.id}>
                                <strong>{turn.speaker === "caller" ? "Caller" : "Senior Phone AI"}:</strong>{" "}
                                {turn.text}
                              </p>
                            ))}
                          </div>
                        </details>
                      ) : "Waiting for provider"}
                    </td>
                    <td>{call.summary ?? "Not available"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty-transcript">No calls have been registered by this application.</p>}
        <p className="fine-print">
          CALL-E may withhold transcript text until a call finishes. This local view keeps transcript
          text in memory only, masks phone-like text, and never exposes the API key to the browser.
        </p>
      </section>
    </main>
  );
}
