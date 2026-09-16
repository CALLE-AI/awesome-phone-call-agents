"use client";

import { useEffect, useRef, useState } from "react";
import type { CallStage } from "@/components/call-status-timeline";

// Full-screen, phone-native "on-call" view for small screens. The call takes over the
// whole display — the way a real call does — and the live captions are the star: large,
// high-contrast, the callee's words made readable for someone who cannot hear them.
// On desktop the inline CallStatusTimeline is shown instead (see page.tsx).

const BARS = [0, 90, 180, 270, 120, 300, 60, 210, 150, 40, 260, 100, 320, 80, 200, 140, 300, 20, 180, 240, 60, 160];

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CallOverlay({
  stage,
  captions,
  phoneMasked,
}: {
  stage: CallStage;
  captions: { speaker: string; text: string; offsetSeconds: number }[];
  phoneMasked: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    if (stage === "done") return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  // Lock the page behind the overlay so nothing scrolls under the takeover.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const latest = captions[captions.length - 1];
  const history = captions.slice(0, -1).slice(-3);
  const dialing = stage === "dialing";

  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Call in progress">
      {/* Status bar */}
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em]" style={{ color: "var(--signal)" }}>
          <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ backgroundColor: "oklch(0.65 0.2 25 / 0.7)" }} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "oklch(0.65 0.2 25)" }} />
          </span>
          Live call
        </span>
        <span className="font-mono text-sm tabular-nums" style={{ color: "var(--hero-fg)" }} aria-label={`On the call for ${fmt(elapsed)}`}>
          {fmt(elapsed)}
        </span>
      </div>

      {/* Callee identity + disclosure */}
      <div className="mt-6 flex flex-col items-center text-center">
        <div className="call-emitter" aria-hidden="true">
          <span /><span /><span />
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
            <path d="M5.2 4.4a1.4 1.4 0 0 1 1.9-.2l1.7 1.3c.5.4.6 1 .4 1.6l-.5 1.3c-.1.4 0 .8.3 1.1l2.6 2.6c.3.3.7.4 1.1.3l1.3-.5c.6-.2 1.2-.1 1.6.4l1.3 1.7c.5.6.4 1.5-.2 2l-1 .9c-.9.8-2.1 1-3.2.5-2.2-1-4.2-2.5-5.9-4.2S3.3 9.6 2.4 7.4c-.5-1.1-.3-2.4.6-3.1z" fill="currentColor" />
          </svg>
        </div>
        <p className="mt-4 font-mono text-sm" style={{ color: "var(--hero-dim)" }}>{phoneMasked || "Connecting…"}</p>
        <p className="mt-1 font-display text-2xl" style={{ color: "var(--hero-fg)" }}>
          {dialing ? "Dialing…" : "RelayGoal is on the call"}
        </p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[0.7rem] uppercase tracking-wider" style={{ borderColor: "oklch(1 0 0 / 0.16)", color: "var(--hero-dim)" }}>
          <svg viewBox="0 0 20 20" width="12" height="12" fill="var(--signal)"><path d="M7.5 13.5 3.8 9.8l1.4-1.4 2.3 2.3 6-6 1.4 1.4z" /></svg>
          Agent disclosed · calling on your behalf
        </span>

        {/* Voice you can't hear, made visible */}
        <div className="waveform waveform-xl mt-6 w-full max-w-xs" aria-hidden="true">
          {BARS.map((d, i) => <span key={i} style={{ animationDelay: `${d}ms` }} />)}
        </div>
      </div>

      {/* Live captions — the payload. Newest line large; recent lines fade above it. */}
      <div className="mt-auto" aria-live="polite" aria-atomic="false">
        <p className="call-live-eyebrow mb-3">Live captions</p>
        <div className="flex flex-col gap-2">
          {history.map((c) => (
            <p key={c.offsetSeconds} className="text-sm leading-snug" style={{ color: "var(--hero-dim)" }}>
              <span className="font-mono text-[0.68rem] uppercase tracking-wider" style={{ color: "var(--hero-dim)" }}>
                {c.speaker !== "bot" ? "Them" : "Agent"}
              </span>{" "}
              {c.text}
            </p>
          ))}
          {latest ? (
            <p className="leading-snug">
              <span className="block font-mono text-[0.72rem] uppercase tracking-[0.16em]" style={{ color: latest.speaker !== "bot" ? "var(--signal)" : "var(--hero-dim)" }}>
                {latest.speaker !== "bot" ? "The other person" : "RelayGoal agent"}
              </span>
              <span className="mt-1 block font-display text-[1.6rem] leading-tight" style={{ color: "var(--hero-fg)" }}>
                {latest.text}
              </span>
            </p>
          ) : (
            <p className="font-mono text-sm" style={{ color: "var(--hero-dim)" }}>Waiting for the other person to speak…</p>
          )}
        </div>
      </div>

      {/* Reassurance */}
      <p className="mt-6 border-t pt-4 text-center text-sm" style={{ borderColor: "oklch(1 0 0 / 0.1)", color: "var(--hero-dim)" }}>
        You&apos;re never on the line. Every answer comes back pinned to their exact words.
      </p>
    </div>
  );
}
