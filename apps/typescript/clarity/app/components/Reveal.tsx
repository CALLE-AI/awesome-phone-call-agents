"use client";

import { getReveal } from "@/lib/result";
import type { ClarifiedFact } from "@/lib/types";

/**
 * The whole result screen: what the application said, and what it actually is.
 *
 * Nothing else belongs here. The evidence, the questions, the transcript and
 * what the call failed to settle are all real and all one click away — but a
 * screen that shows them alongside the conclusion is a report, and a report
 * takes a minute to read. This takes two seconds.
 */
export function Reveal({ fact }: { fact: ClarifiedFact }) {
  const reveal = getReveal(fact);

  return (
    <div className="rise rounded-2xl border border-line bg-panel px-5 py-8 text-center shadow-xl shadow-black/30 sm:px-10 sm:py-12">
      <span className="rail text-fog/50">before</span>
      <p className="pt-2 font-serif text-[26px] italic leading-tight text-fog/70 sm:text-[32px]">
        {reveal.before}
      </p>

      <span
        aria-hidden
        className="my-6 block text-[22px] leading-none text-accent/60 sm:my-8 sm:text-[26px]"
      >
        ↓
      </span>

      <span className="rail text-accent">after</span>
      <p className="pt-2 text-[42px] font-bold leading-[1.05] tracking-tight text-accent sm:text-[64px]">
        {reveal.after}
      </p>

      {(reveal.correction || reveal.basis) && (
        <div className="mt-7 space-y-1.5 border-t border-line-soft pt-6">
          {reveal.correction && (
            <p className="text-[16px] font-semibold leading-snug text-chalk sm:text-[19px]">
              {reveal.correction}
            </p>
          )}
          {reveal.basis && (
            <p className="text-[16px] font-semibold leading-snug text-fog sm:text-[19px]">
              {reveal.basis}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
