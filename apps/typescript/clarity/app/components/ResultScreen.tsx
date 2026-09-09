import { useState } from "react";
import { callFailure } from "@/lib/call-status";
import type { ResultView } from "@/lib/types";
import { EvidenceTrail } from "./EvidenceTrail";
import { Reveal } from "./Reveal";

type Props = {
  view: ResultView;
  candidateName: string;
  onReset: () => void;
};

export function ResultScreen({ view, candidateName, onReset }: Props) {
  const [showTrail, setShowTrail] = useState(false);
  const { fact, session: { call } } = view;
  const failure =
    call && (call.status === "failed" || call.status === "canceled") ? callFailure(call) : null;

  return (
    <section className="rise space-y-6">
      {failure ? (
        <div className="space-y-3 rounded-xl border border-amber/30 bg-amber/[0.04] p-5 text-sm text-chalk/90">
          <h2 className="text-[19px] font-semibold tracking-tight text-chalk">
            {failure.title}
          </h2>
          <p className="text-fog">{failure.message}</p>
          {/* Why it did not connect. Without this the screen says a call
              failed and gives the operator nothing to act on — the reason
              was on the record the whole time, one field away. */}
          {failure.diagnosis && (
            <div className="space-y-1.5 border-t border-amber/20 pt-3">
              <p className="font-medium text-chalk">{failure.diagnosis.reason}</p>
              <p className="text-[13px] leading-relaxed text-fog">{failure.diagnosis.hint}</p>
              {(failure.diagnosis.code || failure.diagnosis.raw) && (
                <details className="pt-1">
                  <summary className="rail cursor-pointer select-none text-fog/50 transition hover:text-chalk">
                    provider detail
                  </summary>
                  <p className="mt-1.5 break-words border-l border-amber/20 pl-2.5 font-mono text-[11px] leading-relaxed text-fog/70">
                    {[failure.diagnosis.code, failure.diagnosis.raw].filter(Boolean).join(" · ")}
                  </p>
                </details>
              )}
            </div>
          )}
        </div>
      ) : (
        fact && <Reveal fact={fact} />
      )}

      {fact && !failure && (
        <div>
          <button
            type="button"
            onClick={() => setShowTrail((open) => !open)}
            aria-expanded={showTrail}
            className="cursor-pointer text-[13px] text-fog underline decoration-line underline-offset-4 transition hover:text-chalk"
          >
            {showTrail ? "Hide the evidence" : "See how Clarity learned this"}
          </button>
          {showTrail && (
            <div className="pt-5">
              <EvidenceTrail
                fact={fact}
                trail={view.trail}
                candidateName={candidateName}
              />
            </div>
          )}
        </div>
      )}

      <div className="pt-1">
        <button
          type="button"
          onClick={onReset}
          className="cursor-pointer rounded-lg border border-line px-3.5 py-2 text-xs text-fog transition hover:border-fog hover:text-chalk"
        >
          Screen another
        </button>
      </div>
    </section>
  );
}
