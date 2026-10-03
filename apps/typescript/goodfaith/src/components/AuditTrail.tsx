// File: src/components/AuditTrail.tsx
"use client";
import { useId, useState } from "react";
import type { NormalizedResult } from "@/lib/normalize";

export function AuditTrail({ row, mode }: { row: NormalizedResult; mode: "mock" | "live" }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!row.evidence) return <span className="text-xs text-paper-500">no evidence</span>;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-accent-soft"
      >
        <span aria-hidden className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
          ›
        </span>
        {open ? "Hide the receipt" : "Show the receipt"}
      </button>

      {open && (
        <div
          id={panelId}
          className="mt-2.5 animate-fade-in rounded-lg border border-ink-700 border-l-2 border-l-accent/60 bg-ink-850/70 p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-paper-500">
              Quoted verbatim on the call
            </span>
            {mode === "mock" && (
              <span className="badge border border-ink-600 bg-ink-800 text-paper-400">Mock · recorded sample</span>
            )}
          </div>
          <blockquote className="border-l-2 border-ink-600 pl-3 font-serif text-[0.95rem] italic leading-relaxed text-paper-100">
            &ldquo;{row.evidence.quoted_verbatim}&rdquo;
          </blockquote>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper-500">
            <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-paper-400">
              {row.evidence.speaker ?? "clinic"}
            </span>
            {row.evidence.offset_seconds !== null && (
              <>
                <span aria-hidden>·</span>
                <span className="tnum">at {row.evidence.offset_seconds}s in the transcript</span>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
