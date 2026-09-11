import type { ReactNode } from "react";
import { factNeed, factTopic } from "@/lib/result";
import type { Clarification } from "@/lib/types";

type Props = {
  primary: Clarification;
  secondary: Clarification[];
  candidateName: string;
  roleTitle: string | null;
  candidatePhone: string | null;
  requiresPhone: boolean;
  busy: boolean;
  consentForm?: ReactNode;
  halted?: boolean;
  onStartCall: () => void;
  onEditApplication: () => void;
};

export function ClarificationScreen({
  primary,
  secondary,
  candidateName,
  roleTitle,
  candidatePhone,
  requiresPhone,
  busy,
  consentForm,
  halted,
  onStartCall,
  onEditApplication,
}: Props) {
  return (
    <section className="rise space-y-5">
      <div>
        <span className="rail text-fog/60">{roleTitle ?? "Application"}</span>
        <h2 className="text-2xl font-bold tracking-tight text-chalk">{candidateName}</h2>
      </div>

      <div className="rounded-2xl border border-line bg-panel p-5 shadow-lg shadow-black/20 sm:p-7">
        <span className="rail text-fog/60">vague claim</span>
        <p className="pt-2 font-serif text-[22px] italic leading-snug text-chalk sm:text-[26px]">
          “{primary.claim}”
        </p>
        <div className="mt-6 border-t border-line-soft pt-5">
          <span className="rail text-accent">need to clarify</span>
          <p className="pt-2 text-[18px] font-semibold leading-snug tracking-tight text-chalk sm:text-[21px]">
            {factNeed(primary)}
          </p>
        </div>
      </div>

      {consentForm}

      {/* Synthetic runs do not need a dialable recipient. */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onStartCall}
            disabled={busy || halted || (!candidatePhone && requiresPhone)}
            className="cursor-pointer rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-ink shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Clarify by phone
          </button>
          <button
            type="button"
            onClick={onEditApplication}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-line px-3.5 py-2 text-xs text-fog transition hover:border-fog hover:text-chalk disabled:cursor-not-allowed disabled:opacity-35"
          >
            Edit application
          </button>
        </div>
        {candidatePhone ? (
          <p className="rail text-fog/60">Authorized destination: {candidatePhone}</p>
        ) : (
          requiresPhone && (
            <p className="max-w-prose text-[13px] leading-relaxed text-amber">
              Confirm the agreed destination and recipient consent before placing this call.
            </p>
          )
        )}
      </div>

      {secondary.length > 0 && (
        <details className="pt-1">
          <summary className="rail cursor-pointer select-none text-fog/50 transition hover:text-chalk">
            other possible questions · {secondary.length}
          </summary>
          <ul className="mt-3 space-y-3 border-l border-line pl-3.5">
            {secondary.map((clarification) => (
              <li key={clarification.id} className="space-y-1">
                <p className="text-[13px] font-medium text-chalk/80">
                  {factTopic(clarification)}
                </p>
                <p className="text-[13px] leading-snug text-fog">{factNeed(clarification)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
