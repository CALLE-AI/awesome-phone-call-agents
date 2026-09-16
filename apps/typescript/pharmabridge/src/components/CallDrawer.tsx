"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Database, Quote, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { CallPlan } from "@/lib/mission";
import type { CallEventView, CallView } from "@/lib/types";
import { cx } from "@/lib/ui";
import { BriefView } from "./BriefView";
import { Chip, ConfidenceMeter, ModeDot } from "./ui";

export interface DrawerData {
  title: string;
  subtitle: string;
  staffLabel: string;
  call: CallView | null;
  events: CallEventView[];
  plan: CallPlan | null;
  mode: string | null;
  dialTarget: string | null;
  recordKey: string | null;
}

type Tab = "conversation" | "result" | "timeline" | "brief" | "record";
const TABS: { id: Tab; label: string }[] = [
  { id: "conversation", label: "Conversation" },
  { id: "result", label: "Structured result" },
  { id: "timeline", label: "Timeline" },
  { id: "brief", label: "Agent brief" },
  { id: "record", label: "Recording" },
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function formatValue(value: unknown): string {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value === "number") return value === 0 ? "" : String(value);
  return typeof value === "string" ? value.replace(/_/g, " ") : JSON.stringify(value);
}

export function CallDrawer({ data, onClose }: { data: DrawerData | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("conversation");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const call = data?.call ?? null;
  const turns = call?.attempts.flatMap((a) => a.transcriptTurns) ?? [];
  const quote = call?.structuredResult?.evidence_quote;
  const evidence = typeof quote === "string" && quote.length > 8 ? normalize(quote).slice(0, 48) : "";
  const providerIds = [...new Set((call?.attempts ?? []).map((a) => a.providerCallId).filter(Boolean))];

  return (
    <AnimatePresence>
      {data && (
        <>
          <motion.div className="fixed inset-0 z-[1150] bg-slate-900/25 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="fixed inset-y-0 right-0 z-[1160] flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 260 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div className="min-w-0">
                <div className="truncate font-display text-lg font-semibold text-slate-900">{data.title}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-slate-500">{data.subtitle}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.mode && (
                    <Chip tone="white" className="px-2">
                      <ModeDot live={data.mode === "live"} />
                    </Chip>
                  )}
                  {call && <Chip>status: {call.status}</Chip>}
                  {data.recordKey && (
                    <Chip tone="violet">
                      <Database className="h-3 w-3" /> Recorded
                    </Chip>
                  )}
                </div>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 pt-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    "shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition",
                    tab === t.id ? "border-violet-500 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-800",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="scroll-thin flex-1 overflow-auto p-5">
              {tab === "conversation" && (
                <div className="space-y-3">
                  {turns.length === 0 && <p className="text-sm text-slate-400">No transcript yet. Turns appear as the call progresses or once it ends.</p>}
                  {turns.map((turn, i) => {
                    if (turn.speaker === "unknown") {
                      return (
                        <div key={i} className="flex justify-center">
                          <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">{turn.text}</span>
                        </div>
                      );
                    }
                    const bot = turn.speaker === "bot";
                    const isEvidence = !bot && evidence && normalize(turn.text).includes(evidence);
                    return (
                      <div key={i} className={cx("flex gap-2", bot && "flex-row-reverse")}>
                        <div className={cx("mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", bot ? "brand-bg text-white" : "bg-slate-200 text-slate-600")}>
                          {bot ? <Bot className="h-3.5 w-3.5" /> : data.staffLabel[0]}
                        </div>
                        <div
                          className={cx(
                            "max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                            bot ? "rounded-tr-sm bg-violet-600 text-white" : "rounded-tl-sm bg-slate-100 text-slate-800",
                            isEvidence && "ring-2 ring-emerald-400",
                          )}
                        >
                          {turn.text}
                          <div className={cx("mt-1 flex items-center gap-2 font-mono text-[9.5px]", bot ? "text-violet-200" : "text-slate-400")}>
                            {turn.offsetSeconds != null ? `${turn.offsetSeconds}s` : ""}
                            {isEvidence && (
                              <span className="inline-flex items-center gap-1 font-sans font-bold text-emerald-600">
                                <Quote className="h-3 w-3" /> cited as evidence
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab === "result" && (
                <div className="space-y-5">
                  {!call?.structuredResult && (
                    <p className="text-sm text-slate-400">
                      {call?.status === "failed"
                        ? `No structured result: ${call.failureMessage ?? call.failureCode ?? "the call failed"}.`
                        : "The schema-validated result appears once the call ends."}
                    </p>
                  )}
                  {call?.structuredResult && (
                    <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                      {Object.entries(call.structuredResult).map(([key, value]) => {
                        const shown = formatValue(value);
                        return (
                          <div key={key} className="grid grid-cols-[180px_1fr] gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
                            <span className="font-mono text-[11px] text-slate-500">{key}</span>
                            <span className={cx("text-[13px]", shown ? "font-medium text-slate-800" : "italic text-slate-300")}>{shown || "not stated"}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {call?.completionConfidence && (
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                      <span className="text-[12px] text-slate-500">task_completed: {String(call.taskCompleted)}</span>
                      <ConfidenceMeter score={call.completionConfidence.score} label={call.completionConfidence.label} />
                    </div>
                  )}
                  {call && call.evidence.length > 0 && (
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Evidence</div>
                      <ul className="space-y-1.5 text-[13px] text-slate-600">
                        {call.evidence.map((e, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-emerald-500">•</span>
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {tab === "timeline" && (
                <ol className="relative space-y-4 border-l-2 border-slate-100 pl-5">
                  {data.events.length === 0 && <li className="text-sm text-slate-400">No events yet.</li>}
                  {data.events.map((e) => (
                    <li key={e.id} className="relative">
                      <span className={cx("absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-2 ring-white", e.level === "warning" || e.level === "error" ? "bg-rose-400" : "bg-violet-400")} />
                      <div className="font-mono text-[10.5px] text-slate-400">
                        {new Date(e.createdAt).toLocaleTimeString()} · {e.type}
                      </div>
                      <div className="text-[13px] text-slate-700">{e.message}</div>
                    </li>
                  ))}
                </ol>
              )}

              {tab === "brief" && (
                <div className="space-y-4">
                  {data.plan?.brief ? <BriefView brief={data.plan.brief} resultSchema={data.plan.resultSchema} /> : <p className="text-sm text-slate-400">The brief is recorded when the call is placed.</p>}
                  {data.plan && (
                    <details className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                      <summary className="cursor-pointer text-[12px] font-semibold text-slate-600">Exact task text</summary>
                      <pre className="mt-3 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-slate-700">{data.plan.task}</pre>
                    </details>
                  )}
                </div>
              )}

              {tab === "record" && (
                <div className="space-y-4 text-[13px] text-slate-600">
                  <p>
                    Every call is written server-side to the PharmaBridge call ledger: the brief, routing, full transcript (phone-menu prompts and keypad presses
                    included), CALL-E events, and the structured result.
                  </p>
                  <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                    {(
                      [
                        ["Ledger record", data.recordKey ? `data/ledger/${data.recordKey}.json` : "not recorded"],
                        ["Call id", call?.id ? `${call.id.slice(0, 40)}${call.id.length > 40 ? "…" : ""}` : "—"],
                        ["Provider call ids", providerIds.length ? providerIds.join(", ") : data.mode === "live" ? "not yet assigned" : "—"],
                        [
                          "Routing",
                          <span key="routing" className="inline-flex items-center gap-1.5">
                            <ModeDot live={data.mode === "live"} />
                            {data.mode === "live" ? data.dialTarget : null}
                          </span>,
                        ],
                        ["Transcript turns", String(turns.length)],
                      ] as [string, ReactNode][]
                    ).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-[150px_1fr] gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
                        <span className="text-[11.5px] font-semibold text-slate-500">{k}</span>
                        <span className="break-all font-mono text-[11.5px] text-slate-700">{v}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[12px] text-slate-500">
                    Audio: the CALL-E Developer API returns transcripts rather than audio files. Use the provider call id to open the recording in the CALL-E dashboard.
                  </p>
                  <Link href="/records" className="inline-flex text-[12.5px] font-semibold text-violet-600 hover:underline">
                    Open all call records →
                  </Link>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
