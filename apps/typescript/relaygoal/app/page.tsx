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
    <>
      <div className="brand-rail" aria-hidden="true" />
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6 sm:px-6">
        <header className="mb-7 border-b border-border pb-6 sm:grid sm:grid-cols-[1fr_auto] sm:items-start sm:gap-x-6">
          <div className="flex items-center gap-3 sm:col-start-1">
            <BrandMark />
            <h1 className="text-3xl sm:text-[2.5rem]">
              Relay<span className="text-primary">Goal</span>
            </h1>
          </div>
          <p className="mt-4 max-w-3xl text-balance text-xl leading-snug sm:col-start-1 sm:text-2xl">
            For people who can&apos;t use the phone. Type the goal, the agent makes the whole call, and you get
            proof of exactly what was said.
          </p>
          <p className="mt-2 hidden max-w-3xl text-muted-foreground sm:col-start-1 sm:block">
            Built for Deaf, hard-of-hearing and speech-disabled callers, and for the advocates and agencies who
            make calls on their behalf. You are never on the line. Every answer comes back tied to the words
            that were actually spoken, or honestly marked as not confirmed.
          </p>
          <div className="mt-5 sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
            <A11yControls />
          </div>
        </header>

        <main
          id="main"
          className="grid flex-1 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
        >
          {/* Control column. Sticky on desktop so it rides the scroll of a long result
              column instead of stranding an empty margin beside it. */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
            <GoalComposer onSubmit={handleCall} disabled={busy} />
            {error && (
              <p role="alert" className="rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-foreground">
                {error}
              </p>
            )}

            {/* Transcript sits under the composer so the evidence link visibly jumps
                across from the receipt (right) to the record (left). */}
            {status === "done" && kind === "single" && outcome && outcome.transcript.length > 0 && (
              <section
                aria-labelledby="transcript-heading"
                className="rounded-xl border border-border bg-surface p-5"
              >
                <div className="mb-3 flex items-center gap-2">
                  <h2 id="transcript-heading" className="text-lg">Full transcript</h2>
                  <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Call record</span>
                </div>
                <TranscriptPanel turns={outcome.transcript} highlightedOffset={highlighted} />
              </section>
            )}
          </div>

          <div className="flex flex-col gap-6">
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
    </>
  );
}

// Brand mark: a phone handset relayed into a verified check — the whole product in one tile.
function BrandMark() {
  return (
    <span className="brand-mark flex h-11 w-11 flex-none items-center justify-center rounded-xl shadow-sm" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
        <path
          d="M5.2 4.4a1.4 1.4 0 0 1 1.9-.2l1.7 1.3c.5.4.6 1 .4 1.6l-.5 1.3c-.1.4 0 .8.3 1.1l2.6 2.6c.3.3.7.4 1.1.3l1.3-.5c.6-.2 1.2-.1 1.6.4l1.3 1.7c.5.6.4 1.5-.2 2l-1 .9c-.9.8-2.1 1-3.2.5-2.2-1-4.2-2.5-5.9-4.2S3.3 9.6 2.4 7.4c-.5-1.1-.3-2.4.6-3.1z"
          fill="currentColor"
        />
        <path d="M15.5 6.2l1.8 1.8 3.4-3.6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function BatchProgress({ label }: { label: string }) {
  return (
    <section aria-labelledby="batch-progress-heading" className="rounded-xl border border-border bg-surface p-5">
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
// and "How it works" disappears the moment a real result takes its place. It leads
// with a ghosted sample of the proof receipt, so a first-time visitor sees the
// payoff before they place a call.
function IdlePanel() {
  const steps = [
    { n: 1, t: "Type the goal", d: "Say what you need in plain language. There is no phone call for you to take." },
    { n: 2, t: "The agent calls", d: "It holds the conversation, works through any phone menu, and captions everything live." },
    { n: 3, t: "You get proof", d: "Each answer is bound to the exact words that were said, or marked not confirmed." },
  ];
  return (
    <div className="flex flex-col gap-4">
      <SampleReceipt />
      <section aria-labelledby="how-heading" className="rounded-xl border border-border bg-surface p-6">
        <h2 id="how-heading" className="text-2xl">How it works</h2>
        <ol className="mt-5 flex flex-col gap-0">
          {steps.map((s, i) => (
            <li key={s.n} className="flex gap-4 pb-5 last:pb-0">
              <span className="relative flex flex-col items-center">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
                  {s.n}
                </span>
                {i < steps.length - 1 && <span aria-hidden="true" className="mt-1 w-0.5 flex-1 bg-border" />}
              </span>
              <span className="pt-1">
                <span className="block font-semibold">{s.t}</span>
                <span className="text-muted-foreground">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
          Pick an errand and press <span className="font-semibold text-foreground">Make the call for me</span>, or switch
          to <span className="font-semibold text-foreground">Compare places</span> to call several at once.
        </p>
      </section>
    </div>
  );
}

// A non-interactive, clearly-labelled preview of what a finished proof looks like.
// Decorative only (aria-hidden); the live card replaces it the moment a call runs.
function SampleReceipt() {
  return (
    <div className="relative" aria-hidden="true">
      <div className="receipt overflow-hidden opacity-80">
        <header className="bg-receipt-head px-5 py-3.5 text-receipt-head-foreground">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-receipt-head-foreground/75">Proof of call · Sample</p>
          <p className="mt-1 font-display text-xl">Pharmacy — is my refill ready?</p>
          <p className="mt-2 font-mono text-xs text-receipt-head-foreground/80">+1********42 · 4 exchanges · 0:22 on the call</p>
        </header>
        <div className="flex items-center gap-3 border-b border-border bg-verified/10 px-5 py-3">
          <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-verified text-verified-foreground">
            <svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" /></svg>
          </span>
          <p className="font-semibold text-verified">3 of 3 answers verified from the call</p>
        </div>
        <div className="px-5 py-3.5">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Refill ready</p>
          <p className="mt-0.5 text-2xl font-semibold text-foreground">Yes</p>
          <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-ledger">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
              <span className="text-verified"><svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" /></svg></span>
              <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">They said · 0:08</span>
            </div>
            <p className="px-3 pb-2 pt-2 italic leading-snug">&ldquo;Sure, let me look. <mark className="rounded-sm bg-verified/25 px-0.5 not-italic font-semibold text-foreground">Yes</mark>, the metformin refill is ready for pickup.&rdquo;</p>
          </div>
        </div>
        <div className="receipt-perf" />
      </div>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full border border-receipt-head-foreground/40 bg-receipt-head/90 px-2 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-receipt-head-foreground">
        Sample
      </span>
    </div>
  );
}
