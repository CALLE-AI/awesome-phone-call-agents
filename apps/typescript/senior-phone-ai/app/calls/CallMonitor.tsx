"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DailyBriefing } from "@/lib/briefings/model";
import type { CalleFollowupView } from "@/lib/calle/followup-service";
import type { CalleCallSnapshot } from "@/lib/calle/status";
import type { ScheduledCallSummary } from "@/lib/calle/schedule-types";
import { toE164FromNationalNumber } from "@/lib/safety/phone";

const POLL_INTERVAL_MS = 2_000;

const COUNTRY_OPTIONS = [
  { id: "au", label: "Australia", callingCode: "+61", removeTrunkPrefix: true },
  { id: "nz", label: "New Zealand", callingCode: "+64", removeTrunkPrefix: true },
  { id: "gb", label: "United Kingdom", callingCode: "+44", removeTrunkPrefix: true },
  { id: "us", label: "United States / Canada", callingCode: "+1", removeTrunkPrefix: false },
  { id: "cn", label: "China", callingCode: "+86", removeTrunkPrefix: false },
  { id: "sg", label: "Singapore", callingCode: "+65", removeTrunkPrefix: false },
  { id: "in", label: "India", callingCode: "+91", removeTrunkPrefix: true },
  { id: "jp", label: "Japan", callingCode: "+81", removeTrunkPrefix: true },
  { id: "kr", label: "South Korea", callingCode: "+82", removeTrunkPrefix: true },
] as const;

interface CallListResponse {
  readonly calls: CalleCallSnapshot[];
  readonly unavailableCount: number;
}

interface CallReview {
  readonly briefingId?: string;
  readonly destinationE164: string;
  readonly destinationSummary: string;
  readonly idempotencyKey: string;
  readonly knowledgeSummary?: string;
  readonly purpose: string;
  readonly scheduledFor?: string;
}

interface ScheduleListResponse { readonly calls: ScheduledCallSummary[] }

interface FollowupListResponse {
  readonly calls: CalleFollowupView[];
  readonly enabled: boolean;
  readonly preview?: boolean;
}

interface BriefingListResponse {
  readonly briefings: DailyBriefing[];
}

const FOLLOWUP_LABELS: Record<CalleFollowupView["status"], string> = {
  previewed: "Preview — not sent",
  waiting: "Waiting for call completion",
  checking: "Reading call result",
  searching: "Preparing SMS / searching",
  no_permission: "No verified SMS permission",
  search_failed: "Answer unavailable — no SMS",
  unknown: "Send uncertain — do not retry",
  queued: "Accepted; awaiting receipt",
  sent: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Expired",
};

const followupIsActive = (call: CalleFollowupView) =>
  ["waiting", "checking", "searching", "queued"].includes(call.status);

function localDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
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

async function loadFollowups(signal: AbortSignal): Promise<FollowupListResponse> {
  const response = await fetch("/api/followups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list" }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("SMS follow-up status is unavailable");
  return response.json() as Promise<FollowupListResponse>;
}

async function briefingApi(body: object): Promise<BriefingListResponse & { briefing?: DailyBriefing }> {
  const response = await fetch("/api/briefings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json() as BriefingListResponse & { briefing?: DailyBriefing; error?: string };
  if (!response.ok) throw new Error(result.error ?? "Daily knowledge is unavailable");
  return result;
}

function SmsFollowupCell({ followup }: { followup?: CalleFollowupView }) {
  if (!followup) return <span className="sms-none">No SMS follow-up</span>;
  const label = followup.status === "queued" && followup.receipt?.status === "sent"
    ? "Sent to carrier; delivery pending"
    : FOLLOWUP_LABELS[followup.status];
  return <div className="sms-followup-cell">
    <strong className="status-pill">{label}</strong>
    <small>{followup.destination}</small>
    {followup.message ? <details>
      <summary>{followup.status === "previewed" ? "View SMS preview" : "View SMS message"}</summary>
      {followup.query ? <p><strong>Customer request:</strong> {followup.query}</p> : null}
      <pre className="sms-message">{followup.message}</pre>
    </details> : null}
    <small>
      Recorded {new Date(followup.createdAt).toLocaleString()}
      {followup.dispatchedAt ? ` · ${followup.status === "previewed" ? "Prepared" : "Attempted"} ${new Date(followup.dispatchedAt).toLocaleString()}` : ""}
    </small>
    {followup.receipt?.errorCode ? <small>Twilio error {followup.receipt.errorCode}</small> : null}
    {followup.priorAttempt ? <details><summary>Earlier failed attempt</summary><pre className="sms-message">{followup.priorAttempt.message}</pre></details> : null}
  </div>;
}

export function CallMonitor({ previewSms = false }: { previewSms?: boolean }) {
  const [countryId, setCountryId] = useState("au");
  const [nationalNumber, setNationalNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [preparingKnowledge, setPreparingKnowledge] = useState(false);
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [review, setReview] = useState<CallReview>();
  const [dispatching, setDispatching] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState<string>();
  const [calls, setCalls] = useState<CalleCallSnapshot[]>([]);
  const [followups, setFollowups] = useState<CalleFollowupView[]>([]);
  const [followupsPreview, setFollowupsPreview] = useState(previewSms);
  const [scheduledCalls, setScheduledCalls] = useState<ScheduledCallSummary[]>([]);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [error, setError] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestRef = useRef<AbortController | undefined>(undefined);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  const reviewCall = async (schedule: boolean) => {
    const callPurpose = purpose.trim();
    const country = COUNTRY_OPTIONS.find((option) => option.id === countryId);
    let destination: string;
    try {
      if (!country) throw new Error("Choose a country or region.");
      destination = toE164FromNationalNumber(
        country.callingCode,
        nationalNumber.trim(),
        country.removeTrunkPrefix,
      );
    } catch {
      setError("Enter a valid local phone number. Australian mobiles use the format 04xx xxx xxx.");
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
    let briefingId: string | undefined;
    let knowledgeSummary: string | undefined;
    if (knowledgeEnabled) {
      if (scheduledFor
        && localDateInTimezone(new Date(scheduledFor), "Australia/Sydney") !== localDateInTimezone(new Date(), "Australia/Sydney")) {
        setError("Daily knowledge calls can only be scheduled for later today. Prepare the briefing on the day of a future call.");
        return;
      }
      setPreparingKnowledge(true);
      setKnowledgeMessage("Preparing today’s source-backed knowledge…");
      try {
        const result = await briefingApi({ action: "prepare-shared", refresh: false });
        const briefing = result.briefing;
        if (!briefing || briefing.status === "unavailable") throw new Error("No verified Australian daily knowledge is available today.");
        briefingId = briefing.id;
        knowledgeSummary = `Shared Australian briefing · ${briefing.localDate} · ${briefing.status}`;
        setKnowledgeMessage(`Ready: ${knowledgeSummary}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Daily knowledge could not be prepared.");
        setKnowledgeMessage("");
        return;
      } finally {
        setPreparingKnowledge(false);
      }
    }
    setReview({
      briefingId,
      destinationE164: destination,
      destinationSummary: `[phone ending ${destination.slice(-4)}]`,
      idempotencyKey: crypto.randomUUID(),
      knowledgeSummary,
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
          knowledgeSummary: undefined,
          confirmed: true,
        }),
      });
      const result = await response.json() as { callReference?: string; call?: ScheduledCallSummary; error?: string; followupRegistration?: string };
      if (!response.ok) throw new Error(result.error ?? "CALL-E did not accept the call");
      setDispatchMessage(review.scheduledFor
        ? `Call scheduled for ${new Date(review.scheduledFor).toLocaleString()}.`
        : `CALL-E accepted ${result.callReference ?? "the call"}. Monitoring has started.${result.followupRegistration === "armed" ? " An automatic SMS recap is connected to this called number, subject to the customer's permission. Requested searches use the same follow-up." : result.followupRegistration === "registration_failed" ? " Follow-up registration failed; connect this call on the follow-ups page before it ends." : ""}`);
      setNationalNumber("");
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
        const [scheduleResponse, result, followupResult] = await Promise.all([
          fetch("/api/calls/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list" }),
            cache: "no-store",
            signal: controller.signal,
          }),
          loadCalls(controller.signal),
          loadFollowups(controller.signal).catch(() => undefined),
        ]);
        if (!scheduleResponse.ok) throw new Error("Scheduled calls are unavailable");
        const scheduleResult = await scheduleResponse.json() as ScheduleListResponse;
        if (!active) return;
        failures = 0;
        setCalls(result.calls);
        setScheduledCalls(scheduleResult.calls);
        if (followupResult) {
          setFollowups(followupResult.calls);
          setFollowupsPreview(followupResult.preview === true);
        }
        setUnavailableCount(result.unavailableCount);
        setError(undefined);
        if (result.calls.some((call) => ["queued", "in_progress", "unknown"].includes(call.status))
          || scheduleResult.calls.some((call) => call.status === "pending" || call.status === "claimed")
          || followupResult?.calls.some(followupIsActive)) {
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
    <div className="monitor-page">
      <div className="page-context"><span className="mode">local operator view</span></div>
      <section className="monitor-card" aria-labelledby="monitor-heading">
        <p className="eyebrow">Live call visibility</p>
        <h1 id="monitor-heading">Phone conversations</h1>
        <p className="lede">
          Calls registered by this application appear automatically. Active rows refresh every two
          seconds and show transcript turns as CALL-E publishes them.
        </p>
        <div className="call-form">
          <div className="phone-input-row">
            <div className="phone-input-country">
              <label htmlFor="country-code">Country or region</label>
              <select
                id="country-code"
                onChange={(event) => { setCountryId(event.target.value); setReview(undefined); }}
                value={countryId}
              >
                {COUNTRY_OPTIONS.map((country) => (
                  <option key={country.id} value={country.id}>
                    {country.label} ({country.callingCode})
                  </option>
                ))}
              </select>
            </div>
            <div className="phone-input-number">
              <label htmlFor="destination">Mobile or phone number</label>
              <input
                autoComplete="tel-national"
                id="destination"
                inputMode="tel"
                onChange={(event) => { setNationalNumber(event.target.value); setReview(undefined); }}
                placeholder="04xx xxx xxx"
                value={nationalNumber}
              />
            </div>
          </div>
          <small>
            Select the country, then enter or paste the number. Local, +61, 0061 and 0011 61 formats
            are corrected automatically when Australia is selected.
          </small>
          <div className="knowledge-toggle">
            <label htmlFor="daily-knowledge">
              <input
                checked={knowledgeEnabled}
                id="daily-knowledge"
                onChange={(event) => {
                  setKnowledgeEnabled(event.target.checked);
                  setReview(undefined);
                  setKnowledgeMessage(event.target.checked ? "The shared Australian briefing will be prepared or reused before call review." : "");
                }}
                role="switch"
                type="checkbox"
              />
              Use today’s knowledge briefing
            </label>
            <small>
              Equip CALL-E with the same current Australian news, alerts, services and retirement information for every senior. <a href="/briefings">Review daily knowledge</a>.
            </small>
            {knowledgeMessage ? <small role="status">{knowledgeMessage}</small> : null}
          </div>
          <label htmlFor="purpose">Additional call instruction <span className="optional-label">(optional)</span></label>
          <textarea
            id="purpose"
            maxLength={300}
            onChange={(event) => { setPurpose(event.target.value); setReview(undefined); }}
            placeholder="Optional: Ask about a particular topic or share a one-time message."
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
            <button disabled={preparingKnowledge} onClick={() => void reviewCall(false)} type="button">{preparingKnowledge ? "Preparing knowledge…" : "Review call now"}</button>
            <button disabled={!scheduledLocal || preparingKnowledge} onClick={() => void reviewCall(true)} type="button">{preparingKnowledge ? "Preparing knowledge…" : "Review scheduled call"}</button>
          </div>
        </div>
        {review ? (
          <div className="call-confirmation" role="group" aria-label="Confirm outbound call">
            <h2>Confirm this phone call</h2>
            <p>{previewSms
              ? "For this demo, the agent can prepare a customer-approved SMS preview after the call. Requested searches become sourced customer-facing answers, and no text is sent."
              : "When SMS follow-ups are enabled for this Australian mobile, the agent offers a short recap by text. The called number is saved automatically; after the call, one SMS is sent with the customer’s permission. Requested searches are handled in the same follow-up."}</p>
            <p><strong>Destination:</strong> {review.destinationSummary}</p>
            <p><strong>Daily knowledge:</strong> {review.knowledgeSummary ?? "Off"}</p>
            <p><strong>Additional instruction:</strong> {review.purpose || "None"}</p>
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
        <div className="table-actions"><button onClick={refresh} type="button">Refresh calls and SMS</button></div>
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
            <thead><tr><th>Scheduled for</th><th>Destination</th><th>Additional instruction</th><th>Status</th><th>Action</th></tr></thead>
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
          Pending details are encrypted in the ignored local registry. Safe scheduler diagnostics are written
          to <code>logs/call-activity.ndjson</code> with phone numbers masked.
        </p>
      </section>

      <section className="notes-card monitor-transcript" aria-labelledby="phone-transcript-heading">
        <div className="monitor-status-row">
          <div>
            <p className="eyebrow">Operator review</p>
            <h2 id="phone-transcript-heading">All monitored calls</h2>
          </div>
          <strong className="status-pill" aria-live="polite">{calls.length} calls · {followups.length} SMS records</strong>
        </div>
        {calls.length ? (
          <div className="call-table-wrap">
            <table className="call-table call-history-table">
              <thead>
                <tr><th>Started</th><th>Result</th><th>Summary</th><th>Conversation</th><th>SMS follow-up</th></tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const followup = followups.find((item) =>
                    item.callId === call.callId || item.callReference === call.callId);
                  return <tr key={call.callId}>
                    <td>{call.createdAt ? new Date(call.createdAt).toLocaleString() : "Pending"}</td>
                    <td>
                      <strong className="status-pill">
                        {call.status === call.outcome ? call.status : `${call.status} · ${call.outcome}`}
                      </strong>
                    </td>
                    <td className="operator-summary">{call.summary ?? "Not available"}</td>
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
                    <td><SmsFollowupCell followup={followup} /></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="empty-transcript">No calls have been registered by this application.</p>}
        <p className="fine-print">
          {followupsPreview ? "SMS entries marked Preview are prepared for the demo and are not sent. " : ""}
          CALL-E may withhold transcript text until a call finishes. Its public API does not publish
          stable machine-readable no-answer or voicemail values, so those cases remain incomplete
          unless the bounded provider summary explains more. This local view keeps transcript text
          in memory only, masks phone-like text, and never exposes the API key to the browser.
        </p>
      </section>
    </div>
  );
}
