"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import type { CallPlan } from "@/lib/mission";
import { BriefView } from "./BriefView";

export function BriefModal({
  open,
  loading,
  plan,
  error,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  plan: CallPlan | null;
  error?: string | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="card relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white"
            initial={{ y: 20, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 10, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-600">Before dispatch</div>
                <div className="mt-1 font-display text-xl font-semibold text-slate-900">What each agent will be told</div>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="scroll-thin overflow-auto p-5">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Building the plan…
                </div>
              )}
              {error && <p className="text-sm text-rose-600">{error}</p>}
              {plan?.brief && <BriefView brief={plan.brief} resultSchema={plan.resultSchema} />}
              {plan && (
                <details className="mt-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <summary className="cursor-pointer text-[12px] font-semibold text-slate-600">Exact task text</summary>
                  <pre className="mt-3 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-slate-700">{plan.task}</pre>
                </details>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
