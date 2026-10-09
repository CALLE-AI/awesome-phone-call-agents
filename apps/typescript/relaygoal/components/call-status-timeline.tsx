"use client";

import { useEffect, useRef, useState } from "react";

export type CallStage = "dialing" | "oncall" | "done";

const STEPS = ["Queued", "Dialing", "On the call", "Result ready"] as const;
const BARS = [0, 90, 180, 270, 120, 300, 60, 210, 150, 40, 260, 100, 320, 80, 200, 140, 300, 20, 180, 240, 60, 160, 280, 110];

function stageIndex(stage: CallStage): number {
  return stage === "dialing" ? 1 : stage === "oncall" ? 2 : 3;
}
function fmtElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const FG = "var(--hero-fg)";
const DIM = "var(--hero-dim)";
const SIGNAL = "var(--signal)";

export function CallStatusTimeline({
  stage,
  captions,
  phoneMasked,
}: {
  stage: CallStage;
  captions: { speaker: string; text: string; offsetSeconds: number }[];
  phoneMasked: string;
}) {
  const current = stageIndex(stage);

  const [elapsed, setElapsed] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    if (stage === "done") return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  return (
    <section aria-labelledby="progress-heading" className="call-live p-6 sm:p-7">
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="call-live-eyebrow mb-1.5">Live call</p>
          <h2 id="progress-heading" className="text-2xl" style={{ color: FG, fontFamily: "var(--font-display)" }}>
            {stage === "done" ? "Call finished" : "Calling for you"}
          </h2>
          <p className="mt-1 font-mono text-sm" style={{ color: DIM }}>{phoneMasked}</p>
        </div>
        {stage !== "done" && (
          <span className="inline-flex items-center gap-2 font-mono text-sm" style={{ color: FG }}>
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ backgroundColor: "oklch(0.65 0.2 25 / 0.7)" }} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "oklch(0.65 0.2 25)" }} />
            </span>
            <span aria-label={`On the call for ${fmtElapsed(elapsed)}`}>{fmtElapsed(elapsed)}</span>
          </span>
        )}
      </div>

      {/* Instrument stepper with connecting track. */}
      <ol className="relative mt-6 flex items-center" aria-label="Call progress">
        {STEPS.map((label, i) => {
          const state = i < current ? "done" : i === current ? "current" : "upcoming";
          return (
            <li key={label} className="contents">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="mx-1.5 h-0.5 flex-1 rounded-full"
                  style={{ backgroundColor: i <= current ? SIGNAL : "oklch(1 0 0 / 0.16)" }}
                />
              )}
              <span
                aria-current={state === "current" ? "step" : undefined}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-semibold"
                style={
                  state === "done"
                    ? { backgroundColor: SIGNAL, color: "var(--hero-bg)" }
                    : state === "current"
                      ? { border: `2px solid ${SIGNAL}`, color: FG }
                      : { border: "1px solid oklch(1 0 0 / 0.2)", color: DIM }
                }
              >
                {state === "done" ? (
                  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="currentColor"><path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" /></svg>
                ) : (
                  i + 1
                )}
                <span className="sr-only">{label}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex justify-between font-mono text-[0.7rem] uppercase tracking-wide">
        {STEPS.map((label, i) => (
          <span key={label} style={{ color: i === current ? SIGNAL : DIM }}>{label}</span>
        ))}
      </div>

      {/* Waveform centerpiece — the voice you can't hear, made visible. */}
      <div className="relative mt-7 flex flex-col items-center gap-2.5">
        <div className="waveform waveform-xl w-full max-w-sm" aria-hidden="true">
          {BARS.map((d, i) => (
            <span key={i} style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: DIM }}>
          {stage === "dialing" ? "Dialing…" : "Listening to the call"}
        </p>
      </div>

      {/* Live captions — the accessibility payload, high-contrast on the dark surface. */}
      <div className="relative mt-6" aria-live="polite" aria-atomic="false">
        <p className="call-live-eyebrow mb-2.5">Live captions</p>
        <p className="sr-only">Live captions of the call:</p>
        <ul className="flex flex-col gap-2.5">
          {captions.length === 0 && (
            <li className="font-mono text-sm" style={{ color: DIM }}>Waiting for the other person to speak…</li>
          )}
          {captions.map((c) => {
            const isCallee = c.speaker !== "bot";
            return (
              <li key={c.offsetSeconds} className="leading-snug" style={{ color: isCallee ? FG : DIM }}>
                <span className="font-mono text-xs uppercase tracking-wider" style={{ color: isCallee ? SIGNAL : DIM }}>
                  {isCallee ? "Them" : "Agent"}
                </span>{" "}
                {c.text}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
