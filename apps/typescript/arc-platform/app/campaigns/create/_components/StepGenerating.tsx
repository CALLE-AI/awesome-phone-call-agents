"use client";

import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit, PenLine, SatelliteDish, Star, BarChart3, Target,
  Check, TriangleAlert, ArrowLeft,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWizard } from "./WizardContext";
import type { GeneratedData } from "./WizardContext";
import { StepHeader } from "./WizardChrome";

/* Line icons rather than system emoji, matching StepBrief. */
const STEPS_SEQ = [
  { Icon: BrainCircuit,  text: "Analysing your brief & target audience…" },
  { Icon: PenLine,       text: "Crafting radio scripts in Urdu, English, bilingual…" },
  { Icon: SatelliteDish, text: "Matching FM stations to your cities & budget…" },
  { Icon: Star,          text: "Finding the best micro-influencers for your niche…" },
  { Icon: BarChart3,     text: "Optimising budget allocation & reach estimates…" },
  { Icon: Target,        text: "Finalising campaign strategy & launch timing…" },
];

export default function StepGenerating() {
  const { state, dispatch } = useWizard();
  const [activeIdx, setActiveIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasFired = useRef(false);

  // Animated step ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIdx(i => Math.min(i + 1, STEPS_SEQ.length - 1));
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // API call — fire once
  useEffect(() => {
    if (hasFired.current) return;
    hasFired.current = true;

    fetch("/api/ai/generate-campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: state.brief, pin: state.pinnedExternalId }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Generation failed");
        }
        return res.json() as Promise<GeneratedData>;
      })
      .then(data => {
        dispatch({ type: "SET_GENERATED", generated: data });
        dispatch({ type: "SET_STEP", step: "scripts" });
      })
      .catch(err => {
        setError(err.message || "Something went wrong. Please try again.");
      });
  }, []); // eslint-disable-line

  const progress = Math.min(((activeIdx + 1) / STEPS_SEQ.length) * 100, 95);

  if (error) {
    return (
      <div className="flex flex-col gap-8">
        {/* h2, not the display-weight StepHeader: this is a small recoverable
            error, and the message should carry it. */}
        <h1 className="font-display text-h2 text-text">Generation Failed</h1>
        <section className="flex max-w-xl flex-col items-start gap-4 rounded-card border border-danger bg-surface p-8">
          <TriangleAlert aria-hidden strokeWidth={1.75} className="size-6 text-danger" />
          <p className="text-body text-text-muted">{error}</p>
          <Button onClick={() => dispatch({ type: "SET_STEP", step: "brief" })}>
            <ArrowLeft aria-hidden strokeWidth={1.75} />
            Back to Brief
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        title="Arc AI is building your campaign"
        subtitle={`Crafting a campaign for ${state.brief.productName || "your brand"}`}
        current="generating"
      />

      {/* The work list IS the content here, not decoration around a spinner:
          each line names something Arc is actually doing. */}
      <section className="flex max-w-2xl flex-col gap-6 rounded-card bg-surface p-6 shadow-card sm:p-8">
        <div
          className="h-1.5 w-full overflow-hidden rounded-pill bg-hairline"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Generation progress"
        >
          <div
            className="h-full rounded-pill bg-lilac-deep transition-[width] duration-1000 ease-out motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="flex flex-col gap-1">
          {STEPS_SEQ.map((step, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            return (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-3 rounded-control px-3 py-2.5 transition-colors duration-500 motion-reduce:transition-none",
                  active && "bg-lilac"
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center",
                    done ? "text-text-muted" : active ? "text-ink" : "text-text-muted/40"
                  )}
                >
                  {done ? (
                    <Check aria-hidden strokeWidth={2} className="size-4" />
                  ) : (
                    <step.Icon aria-hidden strokeWidth={1.75} className="size-[18px]" />
                  )}
                </span>

                <span
                  className={cn(
                    "text-small",
                    active ? "font-medium text-ink" : done ? "text-text-muted" : "text-text-muted/50"
                  )}
                >
                  {step.text}
                </span>

                {active ? (
                  <span aria-hidden className="ml-auto flex shrink-0 gap-1">
                    {[0, 1, 2].map(d => (
                      <span
                        key={d}
                        className="size-1 rounded-pill bg-ink/45 motion-safe:animate-pulse"
                        style={{ animationDelay: `${d * 200}ms` }}
                      />
                    ))}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>

        <p className="type-data text-text-muted" aria-live="polite">
          {elapsed}s elapsed · typically 15–25s
        </p>
      </section>
    </div>
  );
}
