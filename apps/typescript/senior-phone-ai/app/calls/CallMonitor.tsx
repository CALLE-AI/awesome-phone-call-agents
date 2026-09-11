"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CalleCallSnapshot } from "@/lib/calle/status";
import type { ScheduledCallSummary } from "@/lib/calle/schedule-types";

const POLL_INTERVAL_MS = 2_000;

interface CallListResponse {
  readonly calls: CalleCallSnapshot[];
  readonly unavailableCount: number;
}

interface CallReview {
  readonly destinationE164: string;
  readonly destinationSummary: string;
  readonly idempotencyKey: string;
  readonly purpose: string;
  readonly scheduledFor?: string;
}

interface ScheduleListResponse { readonly calls: ScheduledCallSummary[] }

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
  const [destinationE164, setDestinationE164] = useState("");
  const [purpose, setPurpose] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [review, setReview] = useState<CallReview>();
  const [dispatching, setDispatching] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState<string>();
  const [calls, setCalls] = useState<CalleCallSnapshot[]>([]);
  const [scheduledCalls, setScheduledCalls] = useState<ScheduledCallSummary[]>([]);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [error, setError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestRef = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  const reviewCall = (schedule: boolean) => {
    const destination = destinationE164.trim();
    const callPurpose = purpose.trim();
    if (!/^\+[1-9][0-9]{7,14}$/.test(destination)) {
      setError("Enter the destination in E.164 format, such as +614XXXXXXXX.");
      return;
    }
    if (callPurpose.length > 300) {
      setError("Keep the optional call purpose within 300 characters.");
      return;
    }
    let scheduledFor: string | undefined;
    if (schedule) {
      const instant = new Date(scheduledLocal);
      if (!scheduledLocal || !Number.isFinite(instant.getTime()) || instant.getTime() < Date.now() + 5_000) {
        setError("Choose a valid time at least five seconds in the future.");
        return;
      }
      scheduledFor = instant.toISOString();
    }
    setError(undefined);
    setDispatchMessage(undefined);
    setReview({
      destinationE164: destination,
      destinationSummary: `[phone ending ${destination.slice(-4)}]`,
      idempotencyKey: crypto.randomUUID(),
      purpose: callPurpose,
      scheduledFor,
    });
  };

  const placeConfirmedCall = async () => {
    if (!review || dispatching) return;
    setDispatching(true);
    setError(undefined);
    try {
      const response = await fetch(review.scheduledFor ? "/api/calls/schedule" : "/api/calls/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...review,
          action: review.scheduledFor ? "create" : undefined,
          destinationSummary: undefined,
          confirmed: true,
        }),
      });
      const result = await response.json() as { callReference?: string; call?: ScheduledCallSummary; error?: string };
      if (!response.ok) throw new Error(result.error ?? "CALL-E did not accept the call");
      setDispatchMessage(review.scheduledFor
        ? `Call scheduled for ${new Date(review.scheduledFor).toLocaleString()}.`
        : `CALL-E accepted ${result.callReference ?? "the call"}. Monitoring has started.`);
      setDestinationE164("");
      setPurpose("");
      setScheduledLocal("");
      setReview(undefined);
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CALL-E did not accept the call");
    } finally {
      setDispatching(false);
    }
  };

  const cancelSchedule = async (id: string) => {
    setError(undefined);
    try {
      const response = await fetch("/api/calls/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Scheduled call could not be canceled");
      setDispatchMessage("The scheduled call was canceled before dispatch.");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scheduled call could not be canceled");
    }
  };

  useEffect(() => {
    let active = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      try {
        const scheduleResponse = await fetch("/api/calls/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list" }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!scheduleResponse.ok) throw new Error("Scheduled calls are unavailable");
        const scheduleResult = await scheduleResponse.json() as ScheduleListResponse;
        const result = await loadCalls(controller.signal);
        if (!active) return;
        failures = 0;
        setCalls(result.calls);
        setScheduledCalls(scheduleResult.calls);
        setUnavailableCount(result.unavailableCount);
        setError(undefined);
        if (result.calls.some((call) => ["queued", "in_progress", "unknown"].includes(call.status))
          || scheduleResult.calls.some((call) => call.status === "pending" || call.status === "claimed")) {
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
        <div className="call-form">
          <label htmlFor="destination">Destination phone number</label>
          <input
            autoComplete="tel"
            id="destination"
            inputMode="tel"
            onChange={(event) => { setDestinationE164(event.target.value); setReview(undefined); }}
            placeholder="+614XXXXXXXX"
            value={destinationE164}
          />
          <small>Use E.164 format: country code with a leading + and no spaces. Do not put this number in `.env.local`.</small>
          <label htmlFor="purpose">Purpose of the call <span className="optional-label">(optional)</span></label>
          <textarea
            id="purpose"
            maxLength={300}
            onChange={(event) => { setPurpose(event.target.value); setReview(undefined); }}
            placeholder="Optional: Ask whether they can hear clearly and thank them."
            rows={3}
            value={purpose}
          />
          <label htmlFor="scheduled-time">Schedule time</label>
          <input
            id="scheduled-time"
            onChange={(event) => { setScheduledLocal(event.target.value); setReview(undefined); }}
            type="datetime-local"
            value={scheduledLocal}
          />
          <small>The time uses this browser&apos;s timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</small>
          <div className="controls">
            <button onClick={() => reviewCall(false)} type="button">Review call now</button>
            <button disabled={!scheduledLocal} onClick={() => reviewCall(true)} type="button">Review scheduled call</button>
          </div>
        </div>
        {review ? (
          <div className="call-confirmation" role="group" aria-label="Confirm outbound call">
            <h2>Confirm this phone call</h2>
            <p><strong>Destination:</strong> {review.destinationSummary}</p>
            <p><strong>Purpose:</strong> {review.purpose || "No specific purpose"}</p>
            <p><strong>When:</strong> {review.scheduledFor ? new Date(review.scheduledFor).toLocaleString() : "Now"}</p>
            <p className="fine-print">
              Confirm that you have permission to call this number. A scheduled call can be canceled
              below until dispatch starts. Once CALL-E accepts it, closing this page will not cancel it.
            </p>
            <div className="controls">
              <button disabled={dispatching} onClick={placeConfirmedCall} type="button">
                {dispatching ? "Saving…" : review.scheduledFor ? "Confirm and schedule call" : "Confirm and place call"}
              </button>
              <button className="danger" disabled={dispatching} onClick={() => setReview(undefined)} type="button">
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <div className="table-actions"><button onClick={refresh} type="button">Refresh table</button></div>
        {dispatchMessage ? <p className="success" role="status">{dispatchMessage}</p> : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {unavailableCount ? (
          <p className="error" role="status">{unavailableCount} registered call could not be refreshed.</p>
        ) : null}
      </section>

      <section className="notes-card monitor-transcript" aria-labelledby="scheduled-heading">
        <div className="monitor-status-row">
          <div><p className="eyebrow">Host schedule</p><h2 id="scheduled-heading">Scheduled calls</h2></div>
          <strong className="status-pill">{scheduledCalls.filter((call) => call.status === "pending").length} pending</strong>
        </div>
        {scheduledCalls.length ? (
          <div className="call-table-wrap"><table className="call-table">
            <thead><tr><th>Scheduled for</th><th>Destination</th><th>Purpose</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{scheduledCalls.map((call) => (
              <tr key={call.id}>
                <td>{new Date(call.scheduledFor).toLocaleString()}</td>
                <td>{call.destinationSummary}</td>
                <td>{call.purpose}</td>
                <td><strong className="status-pill">{call.status}</strong></td>
                <td>{call.status === "pending"
                  ? <button className="danger" onClick={() => void cancelSchedule(call.id)} type="button">Cancel</button>
                  : call.callReference ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="empty-transcript">No calls are scheduled.</p>}
        <p className="fine-print">
          The local scheduler checks while this page is open and catches up on its next check after a restart.
          Production deployment requires the authenticated durable scheduler work tracked in SPA-011.
          Pending details are encrypted in the ignored local registry.
        </p>
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
                <tr><th>Started</th><th>Call</th><th>Status</th><th>Outcome</th><th>Conversation</th><th>Summary</th></tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.callId}>
                    <td>{call.createdAt ? new Date(call.createdAt).toLocaleString() : "Pending"}</td>
                    <td><code>{call.callId}</code></td>
                    <td><strong className="status-pill">{call.status}</strong></td>
                    <td><strong className="status-pill">{call.outcome}</strong></td>
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
          CALL-E may withhold transcript text until a call finishes. Its public API does not publish
          stable machine-readable no-answer or voicemail values, so those cases remain incomplete
          unless the bounded provider summary explains more. This local view keeps transcript text
          in memory only, masks phone-like text, and never exposes the API key to the browser.
        </p>
      </section>
    </main>
  );
}
