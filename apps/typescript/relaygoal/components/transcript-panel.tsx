"use client";

import { useEffect, useRef } from "react";
import type { TranscriptTurn } from "@/src/core/types";

function fmt(offset: number): string {
  const m = Math.floor(offset / 60);
  const s = offset % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TranscriptPanel({
  turns,
  highlightedOffset,
}: {
  turns: TranscriptTurn[];
  highlightedOffset: number | null;
}) {
  const containerRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (highlightedOffset === null || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(`[data-offset="${highlightedOffset}"]`);
    if (!el) return;
    const reduce = document.documentElement.getAttribute("data-motion") === "reduced" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    el.classList.remove("evidence-flash");
    // reflow so the animation can retrigger
    void el.offsetWidth;
    el.classList.add("evidence-flash");
  }, [highlightedOffset]);

  if (turns.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground">
        No transcript — the call didn&apos;t connect.
      </p>
    );
  }

  return (
    <ol ref={containerRef} className="flex flex-col gap-3" aria-label="Full call transcript">
      {turns.map((t) => {
        const isCallee = t.speaker !== "bot";
        return (
          <li
            key={t.offsetSeconds}
            data-offset={t.offsetSeconds}
            className={`rounded-lg border p-3 ${
              isCallee ? "border-border bg-card" : "border-transparent bg-muted/50"
            }`}
          >
            <div className="mb-1 flex items-center gap-2 text-sm">
              <span className={`font-semibold ${isCallee ? "text-foreground" : "text-muted-foreground"}`}>
                {isCallee ? "The other person" : "RelayGoal agent"}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{fmt(t.offsetSeconds)}</span>
            </div>
            <p className={isCallee ? "text-foreground" : "text-muted-foreground"}>{t.text}</p>
          </li>
        );
      })}
    </ol>
  );
}
