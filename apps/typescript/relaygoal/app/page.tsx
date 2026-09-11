"use client";

import { useState } from "react";
import { A11yControls } from "@/components/a11y-controls";
import { GoalComposer, type CallRequest } from "@/components/goal-composer";
import { CallStatusTimeline, type CallStage } from "@/components/call-status-timeline";
import { VerifiedResultCard } from "@/components/verified-result-card";
import { TranscriptPanel } from "@/components/transcript-panel";
import { BatchResultCard } from "@/components/batch-result-card";
import type { VerifiedOutcome, TranscriptTurn } from "@/src/core/types";
import type { BatchOutcome } from "@/src/core/batch";

type Status = "idle" | CallStage;
type ResultKind = "single" | "batch";
type Caption = { speaker: string; text: string; offsetSeconds: number };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function prefersReduced(): boolean {
  if (typeof window === "undefined") return false;
  return (
    document.documentElement.getAttribute("data-motion") === "reduced" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [kind, setKind] = useState<ResultKind>("single");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [outcome, setOutcome] = useState<VerifiedOutcome | null>(null);
  const [batch, setBatch] = useState<BatchOutcome | null>(null);
  const [meta, setMeta] = useState<{ phoneMasked: string; presetLabel: string }>({ phoneMasked: "", presetLabel: "" });
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = status === "dialing" || status === "oncall";

  function reset(k: ResultKind) {
    setError(null);
    setOutcome(null);
    setBatch(null);
    setCaptions([]);
    setHighlighted(null);
    setKind(k);
    setStatus("dialing");
  }

  async function handleCall(req: CallRequest) {
    const reduce = prefersReduced();
    try {
      if (req.mode === "batch") {
        reset("batch");
        await wait(reduce ? 0 : 700);
        setStatus("oncall");
        const res = await fetch("/api/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ presetId: req.batchPresetId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "The calls could not be placed.");
        setMeta({ phoneMasked: "", presetLabel: data.presetLabel });
        await wait(reduce ? 0 : 1400);
        setBatch(data.outcome as BatchOutcome);
        setStatus("done");
        return;
      }

      reset("single");
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The call could not be placed.");
      setMeta({ phoneMasked: data.phoneMasked, presetLabel: data.presetLabel });
      await wait(reduce ? 0 : 700);
      setStatus("oncall");
      const turns = (data.outcome.transcript ?? []) as TranscriptTurn[];
      for (const t of turns) {
        setCaptions((prev) => [...prev, { speaker: t.speaker, text: t.text, offsetSeconds: t.offsetSeconds }]);
        await wait(reduce ? 0 : 850);
      }
      if (turns.length === 0) await wait(reduce ? 0 : 900);
      setOutcome(data.outcome as VerifiedOutcome);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  function cite(offset: number) {
    setHighlighted(null);
    requestAnimationFrame(() => setHighlighted(offset));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-6">
      <header className="mb-6 border-b border-border pb-5 sm:grid sm:grid-cols-[1fr_auto] sm:items-start sm:gap-x-6">
        <h1 className="text-3xl sm:text-4xl">
          Relay<span className="text-primary">Goal</span>
        </h1>
        <p className="mt-3 max-w-3xl text-xl leading-snug sm:col-start-1 sm:text-2xl">
          For people who can&apos;t use the phone. Type the goal, the agent makes the whole call, and you get
          proof of exactly what was said.
        </p>
        <p className="mt-2 hidden max-w-3xl text-muted-foreground sm:col-start-1 sm:block">
          Built for Deaf, hard-of-hearing and speech-disabled callers, and for the advocates and agencies who
          make calls on their behalf. You are never on the line. Every answer comes back tied to the words
          that were actually spoken, or honestly marked as not confirmed.
        </p>
        <div className="mt-4 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          <A11yControls />
        </div>
      </header>

      <main
        id="main"
        className="grid flex-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[auto_1fr]"
      >
        <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1">
          <GoalComposer onSubmit={handleCall} disabled={busy} />
          {error && (
            <p role="alert" className="rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-foreground">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {status === "idle" && <IdlePanel />}

          {busy && kind === "single" && (
            <CallStatusTimeline stage={status as CallStage} captions={captions} phoneMasked={meta.phoneMasked} />
          )}
          {busy && kind === "batch" && <BatchProgress label={meta.presetLabel} />}

          {status === "done" && kind === "single" && outcome && (
            <VerifiedResultCard
              outcome={outcome}
              phoneMasked={meta.phoneMasked}
              presetLabel={meta.presetLabel}
              onCiteQuote={cite}
            />
          )}

          {status === "done" && kind === "batch" && batch && (
            <BatchResultCard outcome={batch} presetLabel={meta.presetLabel} />
          )}
        </div>

        {/* Transcript sits under the composer so the two panes balance and the
            evidence link visibly jumps across from the receipt to the record. */}
        {status === "done" && kind === "single" && outcome && outcome.transcript.length > 0 && (
          <section
            aria-labelledby="transcript-heading"
            className="rounded-xl border border-border bg-card p-5 lg:col-start-1 lg:row-start-2"
          >
            <h2 id="transcript-heading" className="mb-3 text-lg">Full transcript</h2>
            <TranscriptPanel turns={outcome.transcript} highlightedOffset={highlighted} />
          </section>
        )}
      </main>

      <footer className="mt-10 border-t border-border pt-5 text-sm text-muted-foreground">
        <p>
          Built on <span className="font-semibold text-foreground">CALL-E</span> goal-driven tasks with structured
          extraction. This demo runs on a mocked call path (no real numbers dialed); the live CALL-E SDK path is an
          explicit opt-in. Every number shown is a reserved-fictional 555-01xx number. RelayGoal is a task relay and
          an auxiliary aid, not a substitute for an interpreter.
        </p>
      </footer>
    </div>
  );
}

function BatchProgress({ label }: { label: string }) {
  return (
    <section aria-labelledby="batch-progress-heading" className="rounded-xl border border-border bg-card p-5">
      <h2 id="batch-progress-heading" className="text-lg">Calling several places for you…</h2>
      <p className="mt-1 text-muted-foreground" aria-live="polite">{label || "Placing the calls and comparing what each one says."}</p>
      <div className="mt-4 flex gap-1.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary [animation-delay:200ms]" />
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary [animation-delay:400ms]" />
      </div>
    </section>
  );
}

// Idle state doubles as the explainer, so the result column is never an empty box
// and "How it works" disappears the moment a real result takes its place.
function IdlePanel() {
  const steps = [
    { n: 1, t: "Type the goal", d: "Say what you need in plain language. There is no phone call for you to take." },
    { n: 2, t: "The agent calls", d: "It holds the conversation, works through any phone menu, and captions everything live." },
    { n: 3, t: "You get proof", d: "Each answer is bound to the exact words that were said, or marked not confirmed." },
  ];
  return (
    <section aria-labelledby="how-heading" className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm font-medium text-muted-foreground">Your result will appear here</p>
      <h2 id="how-heading" className="mt-1 text-2xl">How it works</h2>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-3">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
              {s.n}
            </span>
            <span>
              <span className="block font-semibold">{s.t}</span>
              <span className="text-muted-foreground">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
        Pick an errand and press <span className="font-semibold text-foreground">Make the call for me</span>, or switch
        to <span className="font-semibold text-foreground">Compare places</span> to call several at once.
      </p>
    </section>
  );
}
