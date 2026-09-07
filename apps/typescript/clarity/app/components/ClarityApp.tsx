"use client";

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
        // Who the call would reach, read out of the text that was just
        // submitted. Assigned even when null, so a number found in a previous
        // application can never be carried onto this one.
        setApplication((p) => ({ ...p, candidatePhone: data.candidatePhone ?? undefined }));
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
    if (busy !== null) return;
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
      setError(cause instanceof Error ? cause.message : "Could not place the call.");
      setStage("clarify");
    } finally {
      setBusy(null);
    }
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
  const candidatePhone =
    application.candidatePhone?.trim() || view?.session.application.candidatePhone?.trim() || null;


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
          candidatePhone={candidatePhone}
          requiresPhone={!isDebug && demoMode !== "replay"}
          busy={busy !== null}
          onStartCall={startCall}
          onEditApplication={() => setStage("compose")}
        />
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

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}
