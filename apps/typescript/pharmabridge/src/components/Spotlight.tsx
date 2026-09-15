"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Headphones } from "lucide-react";
import { useEffect, useRef } from "react";
import { ACTIVE_PHASES, PHASE_META, type Slot } from "@/lib/mission";
import { TIER_META, cx, formatClock } from "@/lib/ui";
import { Card, ModeDot, Waveform } from "./ui";

const turnCount = (s: Slot) => s.call?.attempts.reduce((n, a) => n + a.transcriptTurns.length, 0) ?? 0;

/** The call worth watching: the busiest live conversation, or the most recently finished one. */
function pickSpotlight(slots: Slot[]): Slot | null {
  const live = slots.filter((s) => ACTIVE_PHASES.includes(s.phase) && s.call).sort((a, b) => turnCount(b) - turnCount(a) || (a.launchedAt ?? 0) - (b.launchedAt ?? 0));
  if (live[0]) return live[0];
  return slots.filter((s) => s.finishedAt && turnCount(s) > 0).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0] ?? null;
}

export function Spotlight({ slots, onOpen }: { slots: Slot[]; onOpen: (key: string) => void }) {
  const slot = pickSpotlight(slots);
  const turns = slot?.call?.attempts.flatMap((a) => a.transcriptTurns) ?? [];
  const box = useRef<HTMLDivElement>(null);
  const meta = slot ? PHASE_META[slot.phase] : null;
  const tier = slot?.assessment ? TIER_META[slot.assessment.tier] : null;
  const typing = slot && (slot.phase === "talking" || slot.phase === "ivr");
  const staff = slot?.facility.kind === "blood_bank" ? "Blood bank" : "Pharmacy";

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [turns.length, slot?.key]);

  return (
    <Card className="flex h-[480px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="brand-bg flex h-8 w-8 items-center justify-center rounded-xl text-white">
            <Headphones className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">Conversation</div>
            <div className="truncate text-sm font-bold text-slate-900">{slot ? slot.facility.name : "Waiting for a call to connect"}</div>
          </div>
        </div>
        {slot && meta && (
          <div className="flex shrink-0 items-center gap-2">
            {tier ? (
              <span className={cx("rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset", tier.chip)}>{tier.short}</span>
            ) : (
              <>
                <Waveform active={meta.pulse} color={meta.color} bars={5} />
                <span className="text-[11px] font-bold" style={{ color: meta.color }}>
                  {meta.label}
                </span>
              </>
            )}
            {slot.mode && <ModeDot live={slot.mode === "live"} />}
            <span className="font-mono text-[11px] tabular-nums text-slate-400">{slot.launchedAt ? formatClock((slot.finishedAt ?? Date.now()) - slot.launchedAt) : ""}</span>
          </div>
        )}
      </div>

      <div ref={box} className="scroll-thin flex-1 space-y-3 overflow-auto bg-gradient-to-b from-slate-50/60 to-white px-5 py-4">
        {!slot && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
            <Waveform active color="#a855f7" bars={9} />
            Dialing… the first conversation will stream here.
          </div>
        )}
        <AnimatePresence initial={false}>
          {turns.map((turn, i) => {
            if (turn.speaker === "unknown") {
              return (
                <motion.div key={`${slot?.key}-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">{turn.text}</span>
                </motion.div>
              );
            }
            const bot = turn.speaker === "bot";
            const keypad = bot && turn.text.startsWith("⌨");
            return (
              <motion.div
                key={`${slot?.key}-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={cx("flex gap-2", bot && "flex-row-reverse")}
              >
                <div className={cx("mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", bot ? "brand-bg text-white" : "bg-slate-200 text-slate-600")}>
                  {bot ? <Bot className="h-3.5 w-3.5" /> : staff[0]}
                </div>
                <div
                  className={cx(
                    "max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm",
                    keypad ? "bg-amber-50 font-semibold text-amber-800 ring-1 ring-amber-200" : bot ? "rounded-tr-sm bg-violet-600 text-white" : "rounded-tl-sm bg-white text-slate-700 ring-1 ring-slate-200",
                  )}
                >
                  {turn.text}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {typing && (
          <div className="flex gap-1.5 pl-8">
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: `${d * 0.15}s` }} />
            ))}
          </div>
        )}
      </div>

      {slot && (
        <button onClick={() => onOpen(slot.key)} className="border-t border-slate-100 px-5 py-2.5 text-left text-[12px] font-semibold text-violet-600 hover:bg-violet-50/50">
          Open full call record, result, and agent brief →
        </button>
      )}
    </Card>
  );
}
