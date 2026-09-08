"use client";

import { DestinationConsent } from "./DestinationConsent";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CallScreen } from "./CallScreen";
import { ApplicationForm, type SourceKey } from "./ApplicationForm";
import { ClarificationScreen } from "./ClarificationScreen";
import { ResultScreen } from "./ResultScreen";
import { DebugDot } from "./DebugDot";
import type { ApplicationInput, Clarification, ResultView } from "@/lib/types";

type Stage = "compose" | "clarify" | "calling" | "result";

const EMPTY: ApplicationInput = { jobDescription: "", resume: "", answers: "" };

const POLL_MS = 2500;

export function ClarityApp({ demoMode }: { demoMode: string }) {
  const searchParams = useSearchParams();
  const isDebug = searchParams.get("debug") === "1";
  // `?debug=1&fail=1` rehearses the call that never connected.
  const isFailDemo = isDebug && searchParams.get("fail") === "1";

  const [application, setApplication] = useState<ApplicationInput>(EMPTY);
  const [source, setSource] = useState<SourceKey>("jobDescription");
  const [stage, setStage] = useState<Stage>("compose");
  const [busy, setBusy] = useState<null | "analyzing" | "dialing">(null);
  const [error, setError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [view, setView] = useState<ResultView | null>(null);

  const [authorizedDestination, setAuthorizedDestination] = useState<string | null>(null);
  const [halted, setHalted] = useState(false);
  const [reconcileId, setReconcileId] = useState("");

  const poller = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (poller.current) clearTimeout(poller.current);
    poller.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const loadExample = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/example");
      if (!response.ok) throw new Error();
      setApplication(await response.json());
      // The résumé is where the interesting claim is, and the point of the tabs
      // is that you look at one document — so land on that one rather than
      // leaving three filled tabs and no reason to pick any of them.
      setSource("resume");
    } catch {
      setError("Could not load the example application.");
    }
  }, []);

  // Debug mode opens on the seeded application, because its whole purpose is to
  // reach the interesting screens without typing anything first.
  useEffect(() => {
    if (isDebug) void loadExample();
  }, [isDebug, loadExample]);

  const debugFetch = useCallback(
    async (stageName: string, extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ stage: stageName, ...extra });
      const response = await fetch(`/api/debug?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load the debug fixture.");
      return data as { sessionId: string; clarifications: Clarification[]; view: ResultView | null };
    },
    [],
  );

  async function runAnalysis() {
    setAuthorizedDestination(null);
    setHalted(false);
    setReconcileId("");
    setBusy("analyzing");
    setError(null);
    try {
      if (isDebug) {
        const data = await debugFetch("clarify");
        setSessionId(data.sessionId);
        setClarifications(data.clarifications);
      } else {
        const data = await postJson("/api/analyze", application);
        setSessionId(data.sessionId);
        setClarifications(data.clarifications);

      }
      setStage("clarify");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis failed.");
    } finally {
      setBusy(null);
    }
  }

  /** Live polling: the server owns call state, the client only redraws it. */
  const poll = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/call/${id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not read the call.");
      if (data.ambiguous) { setHalted(true); setError(data.error); setStage("clarify"); return; }
      if (data.view) setView(data.view as ResultView);
      if (data.terminal) {
        setStage("result");
        return;
      }
    } catch {
      // Keep polling: a dropped tick must not end a call in flight.
    }
    poller.current = setTimeout(() => void poll(id), POLL_MS);
  }, []);

  async function startCall() {
    if (busy !== null || halted) return;
    setBusy("dialing");
    setError(null);
    setView(null);
    // Show the waiting screen immediately, while the call request is pending.
    setStage("calling");
    try {
      // Debug takes the same route as production — claim, call screen,
      // result — and differs only in that no call is placed and the call state
      // is mock. Nothing advances on its own; "skip to result" is a decision.
      if (isDebug) {
        const data = await debugFetch("call", { sessionId: sessionId ?? "" });
        setSessionId(data.sessionId);
        setView(data.view);
        return;
      }

      if (!sessionId) throw new Error("No active session found.");
      await postJson("/api/call", { sessionId });
      void poll(sessionId);
    } catch (cause) {
      const unknown = !(cause instanceof RequestFailure) || cause.ambiguous;
      setHalted(unknown);
      if (!unknown) setAuthorizedDestination(null);
      setError(unknown ? "Call acceptance is unknown. Calling is halted. Find the existing call in CALL-E and reconcile its call ID below; do not redial." : (cause as Error).message);
      setStage("clarify");
    } finally {
      setBusy(null);
    }
  }

  async function authorize(phone: string) {
    setBusy("dialing");
    setError(null);
    try {
      const data = await postJson("/api/call/authorize", { sessionId, phone, consent: true });
      setAuthorizedDestination(`${data.destination} · ${data.region}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record consent.");
    } finally { setBusy(null); }
  }

  async function reconcile() {
    setBusy("dialing");
    setError(null);
    try {
      await postJson("/api/call/reconcile", { sessionId, callId: reconcileId });
      setHalted(false);
      setStage("calling");
      void poll(sessionId!);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reconcile the call.");
    } finally { setBusy(null); }
  }

  /** Debug-only: hands the completed mock call to the normal result pipeline. */
  async function skipToResult() {
    stopPolling();
    setError(null);
    try {
      const data = await debugFetch("complete", {
        sessionId: sessionId ?? "",
        ...(isFailDemo ? { outcome: "failed" } : {}),
      });
      setView(data.view);
      setStage("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the mock result.");
    }
  }

  function reset() {
    stopPolling();
    setApplication(EMPTY);
    setAuthorizedDestination(null);
    setHalted(false);
    setReconcileId("");
    setSource("jobDescription");
    setStage("compose");
    setSessionId(null);
    setClarifications([]);
    setView(null);
    setError(null);
    if (isDebug) void loadExample();
  }

  const call = view?.session.call ?? null;
  const fact = view?.fact ?? null;
  const primary = clarifications[0] ?? fact?.clarification ?? null;

  const candidateName =
    application.candidateName?.trim() ||
    view?.session.application.candidateName?.trim() ||
    "the candidate";
  const roleTitle =
    application.roleTitle?.trim() || view?.session.application.roleTitle?.trim() || null;



  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-baseline justify-between pb-6">
        <h1 className="text-lg font-bold tracking-tight text-chalk">Clarity</h1>
        <span className="rail text-fog/50">
          {/* A hand-authored run must never read as a real call. */}
          {demoMode === "replay" && !isDebug
            ? view?.session.synthetic
              ? "replay · synthetic run"
              : "replay"
            : "vague claim → phone call → fact"}
        </span>
      </header>

      {error && (
        <div className="mb-5 rounded-lg border border-amber/40 bg-amber/5 px-4 py-3 text-sm text-amber">
          {error}
        </div>
      )}

      {stage === "compose" && (
        <ApplicationForm
          application={application}
          source={source}
          busy={busy !== null}
          onChange={setApplication}
          onSourceChange={setSource}
          onAnalyze={runAnalysis}
          onLoadExample={loadExample}
        />
      )}

      {stage === "clarify" && primary && (
        <ClarificationScreen
          primary={primary}
          secondary={clarifications.slice(1)}
          candidateName={candidateName}
          roleTitle={roleTitle}
          candidatePhone={authorizedDestination}
          halted={halted}
          consentForm={!isDebug && demoMode === "live" && !halted ? <DestinationConsent key={sessionId} busy={busy !== null} authorized={authorizedDestination} onAuthorize={authorize} /> : null}
          requiresPhone={!isDebug && demoMode !== "replay"}
          busy={busy !== null}
          onStartCall={startCall}
          onEditApplication={() => setStage("compose")}
        />
      )}

      {halted && (
        <div className="my-4 space-y-3 rounded-xl border border-amber/40 p-4">
          <p className="text-sm text-fog">Session: {sessionId}. Reconciliation only retrieves a call; it never dials.</p>
          <label htmlFor="reconcile-id" className="block text-sm text-chalk">Existing CALL-E call ID</label>
          <input id="reconcile-id" value={reconcileId} onChange={(event) => setReconcileId(event.target.value)} className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm" />
          <button type="button" disabled={busy !== null || !reconcileId} onClick={reconcile} className="rounded-lg border border-amber px-3 py-2 text-sm text-amber disabled:opacity-35">Reconcile existing call</button>
        </div>
      )}

      {stage === "calling" && (
        <CallScreen
          candidateName={firstName(candidateName)}
          clarification={primary}
          call={call}
          live={!isDebug}
          onSkip={isDebug && busy === null ? skipToResult : null}
        />
      )}

      {stage === "result" && view && (
        <ResultScreen view={view} candidateName={firstName(candidateName)} onReset={reset} />
      )}

      <footer className="mt-auto pt-8 text-xs text-fog/50">
        Clarity gathers evidence. It does not score or recommend candidates.
      </footer>

      {isDebug && <DebugDot />}
    </main>
  );
}

/**
 * "Devan Mistry" → "Devan". These screens read as sentences about a person, and
 * a surname in every one of them reads as a record instead. The capital is the
 * test: the "the candidate" fallback has no first name to take, and clipping it
 * to "the" would be worse than leaving it whole.
 */
function firstName(name: string): string {
  const [first] = name.split(/\s+/);
  return first && /^\p{Lu}/u.test(first) ? first : name;
}

class RequestFailure extends Error {
  constructor(message: string, public ambiguous: boolean) { super(message); }
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestFailure(data.error ?? "Request failed.", data.ambiguous === true || response.status >= 500);
  return data;
}
