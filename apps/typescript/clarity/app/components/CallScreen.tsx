"use client";

import { useEffect, useState } from "react";
import { callProgress } from "@/lib/call-status";
import type { CallRecord, Clarification } from "@/lib/types";

/**
 * What is on screen while the phone is ringing: who is being called, and about
 * what. Nothing more.
 *
 * There is no transcript here and no live analysis. The interesting thing
 * during a call is the call — audible in the room, and in a recording — and a
 * screen that races it for attention only splits it.
 */
export function CallScreen({
  candidateName,
  clarification,
  call,
  live,
  onSkip,
}: {
  candidateName: string;
  clarification: Clarification | null;
  call: CallRecord | null;
  /** False under `?debug=1`: no call is in flight, so nothing may tick or pulse. */
  live: boolean;
  onSkip: (() => void) | null;
}) {
  const progress = callProgress(call);
  const elapsed = useElapsed(live);

  return (
    <section className="rise space-y-7">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className={`size-2 rounded-full bg-accent ${live ? "dot-live" : ""}`} />
          <span role="status" className="rail font-semibold text-accent">
            {progress.label}
          </span>
        </span>
        {live && <span className="rail tabular-nums text-fog/50">{elapsed}</span>}
      </div>

      <h2 className="text-[26px] font-bold leading-tight tracking-tight text-chalk sm:text-[32px]">
        Clarifying with {candidateName} by phone
      </h2>

      {clarification && (
        <div className="rounded-2xl border border-line bg-panel p-5 shadow-lg shadow-black/20 sm:p-7">
          <span className="rail text-fog/60">claim</span>
          <p className="pt-2 font-serif text-[22px] italic leading-snug text-chalk sm:text-[26px]">
            “{clarification.claim}”
          </p>
        </div>
      )}

      {/*
       * In production this screen advances itself: the poll moves it to the
       * result. Under `?debug=1` no call is placed, so this is the only thing
       * that can move it — which makes it the primary control here, not
       * incidental chrome. It says why the screen is stopped, because a call
       * screen that never progresses and offers nothing to click reads as a
       * hang.
       */}
      {onSkip && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-red-500/30 bg-red-500/[0.03] p-4">
          <div className="min-w-0">
            <span className="rail text-red-400/80">debug · mock call</span>
            <p className="pt-1 text-[13px] leading-snug text-fog">
              No call was placed. This screen will not advance on its own.
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="shrink-0 cursor-pointer rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-[13px] font-semibold text-red-300 transition hover:bg-red-500/20 hover:text-red-200"
          >
            Skip to result →
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Seconds since the screen went live, as `mm:ss`.
 *
 * Counted from mount rather than from the record's `createdAt`, because the
 * screen appears the moment the button is pressed and the record does not exist
 * for another second or two. It runs only when `active` — debug mode has no
 * call in flight, and a timer counting up next to a call that is not happening
 * is a fiction.
 */
function useElapsed(active: boolean): string {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, [active]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
