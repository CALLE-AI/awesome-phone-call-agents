"use client";

import { formatOffset } from "@/lib/call-record";
import { getReveal } from "@/lib/result";
import type { ClarifiedFact, TrailStep } from "@/lib/types";

/**
 * How the conclusion was reached, in the order someone would check it.
 *
 * The step that matters is `followUp`, and it is the only one drawn in the
 * caller's colour. It is the only part of this exchange no form could have
 * contained: which second question was worth asking did not exist until the
 * first one had been answered.
 */
export function EvidenceTrail({
  fact,
  trail,
  candidateName,
}: {
  fact: ClarifiedFact;
  trail: TrailStep[];
  candidateName: string;
}) {
  const { clarification } = fact;
  const reveal = getReveal(fact);
  const evidenceTurn = fact.evidence?.turnIndex ?? -1;
  const quoteShownInTrail = trail.some((step) => step.turnIndex === evidenceTurn);

  return (
    <div className="rise space-y-5 border-t border-line pt-6">
      <Step
        label={`What ${candidateName} wrote`}
        meta={clarification.source === "resume" ? "résumé" : "written answers"}
      >
        <span className="font-serif italic text-fog">“{clarification.claim}”</span>
      </Step>

      {trail.map((step) =>
        step.kind === "followUp" ? (
          <div key={step.turnIndex} className="border-l-2 border-accent pl-3.5">
            <Step
              label="Dynamic follow-up"
              marker="↳"
              tone="accent"
              meta={metaFor(step, evidenceTurn)}
            >
              <span className="text-chalk">“{step.text}”</span>
            </Step>
            <p className="pt-2 text-[12px] leading-relaxed text-fog">
              Nothing in the written application could have said which second question to ask. It
              was chosen from the answer above.
            </p>
          </div>
        ) : (
          <Step
            key={step.turnIndex}
            label={step.kind === "answered" ? `${candidateName} answered` : "Clarity asked"}
            meta={metaFor(step, evidenceTurn)}
          >
            <span className={step.kind === "answered" ? "text-chalk" : "text-chalk/90"}>
              “{step.text}”
            </span>
          </Step>
        ),
      )}

      {/* The quote CALL-E extracted, shown only when it is not already one of
          the turns above — otherwise this repeats a line just read. */}
      {fact.evidence?.quote && !quoteShownInTrail && (
        <Step label="Evidence" meta={formatOffset(fact.evidence.offsetSeconds) ?? undefined}>
          <span className="font-serif italic text-chalk">“{fact.evidence.quote}”</span>
        </Step>
      )}

      {reveal.stillUnclear && (
        <Step label="Still unclear" tone="amber">
          <span className="text-chalk/85">{reveal.stillUnclear}</span>
        </Step>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft pt-4 text-[12px] leading-relaxed text-fog/70">
        {fact.answer && (
          <span className="rounded border border-line bg-line/40 px-2 py-0.5 font-mono text-[10px] tracking-wide text-fog">
            {fact.answer.confidence} confidence
          </span>
        )}
        <span className="min-w-0 flex-1">{clarification.whyItMatters}</span>
      </p>
    </div>
  );
}

/** `00:40 · evidence` — the timestamp, and whether this turn is what backs the fact. */
function metaFor(step: TrailStep, evidenceTurn: number): string | undefined {
  const at = formatOffset(step.offsetSeconds);
  const isEvidence = step.turnIndex === evidenceTurn;
  if (!at) return isEvidence ? "evidence" : undefined;
  return isEvidence ? `${at} · evidence` : at;
}

function Step({
  label,
  meta,
  tone,
  marker,
  children,
}: {
  label: string;
  meta?: string;
  tone?: "accent" | "amber";
  marker?: string;
  children: React.ReactNode;
}) {
  const railTone =
    tone === "accent" ? "rail text-accent" : tone === "amber" ? "rail text-amber" : "rail";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className={railTone}>
          {marker && (
            <span aria-hidden className="pr-1.5">
              {marker}
            </span>
          )}
          {label}
        </span>
        {meta && <span className="rail tabular-nums text-fog/40">{meta}</span>}
      </div>
      <p className="text-[13px] leading-relaxed">{children}</p>
    </div>
  );
}
