"use client";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, Database, RotateCcw } from "lucide-react";
import { PHASE_META, type Slot } from "@/lib/mission";
import { TIER_META, cx, formatClock, formatKm } from "@/lib/ui";
import { Chip, ConfidenceMeter, ModeDot, Waveform } from "./ui";

const PIPELINE = ["Dial", "Menu", "Talk", "Extract", "Result"];

export function CallCard({ slot, onOpen, onRetry }: { slot: Slot; onOpen: () => void; onRetry: () => void }) {
  const meta = PHASE_META[slot.phase];
  const tier = slot.assessment ? TIER_META[slot.assessment.tier] : null;
  const accent = tier?.color ?? meta.color;
  const turns = slot.call?.attempts.flatMap((a) => a.transcriptTurns) ?? [];
  const lastTurn = turns.at(-1);
  const elapsed = slot.launchedAt ? (slot.finishedAt ?? Date.now()) - slot.launchedAt : 0;
  const unknown = slot.phase === "unknown";
  // An unknown outcome is resubmitted with the same idempotency key, never retried under a new one.
  const retryable = unknown || ((slot.phase === "error" || slot.phase === "failed" || slot.assessment?.tier === "unreached") && slot.attempt < 5);
  const finding = slot.finding;
  const staffLabel = slot.facility.kind === "blood_bank" ? "Blood bank" : "Pharmacy";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: slot.phase === "skipped" ? 0.55 : 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cx("card relative overflow-hidden rounded-2xl", meta.pulse && "ring-2 ring-violet-200", unknown && "ring-2 ring-amber-200")}
    >
      <div className="h-1 w-full" style={{ background: meta.pulse ? `linear-gradient(90deg, ${accent}, #ec4899)` : accent, opacity: slot.phase === "queued" ? 0.3 : 1 }} />
      {meta.pulse && <div className="shimmer pointer-events-none absolute inset-0" />}

      <button onClick={onOpen} className="relative block w-full p-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: accent }}>
              {slot.order + 1}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-900">{slot.facility.name}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                {slot.mode && <ModeDot live={slot.mode === "live"} />}
                <span className="truncate">
                  {formatKm(slot.facility.distanceKm)} · {slot.mode === "live" ? slot.dialTarget : slot.facility.phoneMasked}
                  {slot.attempt > 1 ? ` · attempt ${slot.attempt}` : ""}
                </span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-slate-500">
            {slot.launchedAt ? formatClock(elapsed) : "--:--"}
            <ChevronRight className="h-4 w-4 text-slate-300" />
          </div>
        </div>

        <div className="mt-4 flex items-start">
          {PIPELINE.map((label, i) => {
            const step = i + 1;
            const done = meta.step > step || (meta.step === 5 && step === 5);
            const current = meta.step === step && meta.pulse;
            const reached = done || current;
            return (
              <div key={label} className="flex flex-1 flex-col items-center">
                <div className="flex w-full items-center">
                  <div className={cx("h-0.5 flex-1", i === 0 && "invisible")} style={{ background: reached ? accent : "#e2e8f0" }} />
                  <div
                    className={cx("h-2.5 w-2.5 rounded-full", current && "animate-pulse")}
                    style={{ background: reached ? accent : "#e2e8f0", boxShadow: current ? `0 0 0 4px ${accent}33` : undefined }}
                  />
                  <div className={cx("h-0.5 flex-1", i === PIPELINE.length - 1 && "invisible")} style={{ background: done ? accent : "#e2e8f0" }} />
                </div>
                <span className={cx("mt-1 text-[9.5px] font-bold uppercase tracking-wider", reached ? "text-slate-600" : "text-slate-300")}>{label}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 min-h-[56px]">
          {tier && slot.assessment ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip className={tier.chip}>{tier.label}</Chip>
                {finding?.onHand && <Chip tone="white">{finding.onHand}</Chip>}
                {finding?.holdOffered === "yes" && (
                  <Chip tone="white">
                    {finding.holdLabel === "reserve" ? "Reserve" : "Hold"}
                    {finding.holdHours ? ` ${finding.holdHours}h` : ""}
                  </Chip>
                )}
                {finding?.price && <Chip tone="white">{finding.price}</Chip>}
              </div>
              <p className="line-clamp-2 text-[12.5px] leading-snug text-slate-600">{slot.call?.summary ?? slot.call?.failureMessage ?? "No summary returned."}</p>
              <ConfidenceMeter score={slot.call?.completionConfidence?.score} label={slot.call?.completionConfidence?.label} />
            </div>
          ) : slot.phase === "error" || unknown ? (
            <p className={cx("flex items-start gap-2 text-[12.5px]", unknown ? "text-amber-700" : "text-rose-600")}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {unknown && <strong className="font-semibold">Outcome unknown. </strong>}
                {slot.error}
              </span>
            </p>
          ) : slot.phase === "skipped" ? (
            <p className="text-[12.5px] text-slate-400">{slot.error ?? "Cancelled before dialing: the target was already reached."}</p>
          ) : (
            <div className="flex items-start gap-3">
              <Waveform active={meta.pulse} color={meta.color} />
              <div className="min-w-0">
                <div className="text-[12px] font-bold" style={{ color: meta.color }}>
                  {meta.label}
                </div>
                {lastTurn && (
                  <p className="line-clamp-2 text-[12px] leading-snug text-slate-500">
                    <span className="font-semibold text-slate-600">{lastTurn.speaker === "bot" ? "Agent" : lastTurn.speaker === "user" ? staffLabel : "Line"}:</span>{" "}
                    {lastTurn.text}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </button>

      {(retryable || slot.recordKey) && (
        <div className="relative flex items-center justify-between border-t border-slate-100 px-4 py-2">
          {retryable ? (
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-violet-600 hover:text-violet-800">
              <RotateCcw className="h-3.5 w-3.5" /> {unknown ? "Resubmit (same idempotency key)" : "Retry"}
            </button>
          ) : (
            <span />
          )}
          {slot.recordKey && (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-400" title="Saved to the call ledger">
              <Database className="h-3 w-3" /> Recorded
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
