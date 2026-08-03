"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────────────────────

type CallPhase =
  | "idle"
  | "planning"
  | "clarifying"
  | "confirming"
  | "running"
  | "polling"
  | "completed"
  | "failed";

interface PlanResult {
  plan_id: string;
  confirm_token?: string | null;
  display_goal?: string;
  clarifying_questions?: string[];
}

interface StatusResult {
  run_id: string;
  status: string;
  message?: string | null;
  next_step?: {
    action?: string | null;
    poll_after_seconds?: number | null;
  } | null;
  result?: {
    post_summary?: string | null;
    transcript?: string | null;
    outcome?: {
      task_completed: boolean;
      completion_confidence: { score: number; label: string };
      evidence?: string[];
    } | null;
    extracted?: {
      calling?: {
        calls?: Array<{
          status: string;
          duration_seconds?: number | null;
          call_start_time?: string | null;
          call_end_time?: string | null;
        }>;
      };
    };
  };
}

interface CallRecord {
  id: string;
  phone: string;
  goal: string;
  run_id?: string;
  retryCount?: number;
  phase: CallPhase;
  status?: StatusResult;
  createdAt: Date;
  error?: string;
  clarifying_questions?: string[];
  planResult?: PlanResult;
}

interface CallTemplate {
  id: string;
  name: string;
  phone?: string;
  goal: string;
  createdAt: string;
}

interface AnalyticsSummary {
  total: number;
  completed: number;
  failed: number;
  task_completed: number;
  avg_confidence: number | null;
  avg_duration_seconds: number | null;
}

// ─── PII masking ──────────────────────────────────────────────────────────────

function redactPII(text: string, knownName?: string | null): string {
  let out = text;
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, "[mobile]");
  if (knownName) {
    const escaped = knownName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped.trim().length > 1)
      out = out.replace(new RegExp(escaped, "gi"), "[name]");
  }
  return out;
}

function maskPhone(value: string): string {
  if (!value) return "[mobile]";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "[mobile]";
  return `${"*".repeat(Math.max(4, digits.length - 2))}${digits.slice(-2)}`;
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function exportCallsAsCSV(calls: CallRecord[]) {
  const header = ["id","phone","goal","phase","run_id","task_completed","confidence","duration_s","summary","timestamp"];
  const rows = calls.map((c) => {
    const outcome = c.status?.result?.outcome;
    const cd = c.status?.result?.extracted?.calling?.calls?.[0];
    return [
      c.id, c.phone,
      `"${c.goal.replace(/"/g,'""')}"`,
      c.phase, c.run_id ?? "",
      outcome != null ? String(outcome.task_completed) : "",
      outcome != null ? String(Math.round(outcome.completion_confidence.score * 100)) : "",
      cd?.duration_seconds != null ? String(cd.duration_seconds) : "",
      c.status?.result?.post_summary ? `"${c.status.result.post_summary.replace(/"/g,'""')}"` : "",
      c.createdAt.toISOString(),
    ];
  });
  const csv = [header,...rows].map((r)=>r.join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `voxra-calls-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportSingleCallAsText(call: CallRecord) {
  const outcome = call.status?.result?.outcome;
  const lines = [
    `Voxra Call Export — ${call.createdAt.toISOString()}`,
    `Run ID: ${call.run_id ?? "n/a"}`,
    `Phone: ${call.phone}`,
    `Goal: ${call.goal}`,
    `Phase: ${call.phase}`,
    "",
    outcome ? `Outcome: ${outcome.task_completed ? "COMPLETED" : "INCOMPLETE"} (${outcome.completion_confidence.label} ${Math.round(outcome.completion_confidence.score*100)}%)` : "",
    outcome?.evidence?.length ? `Evidence:\n${outcome.evidence.map((e)=>`  - ${e}`).join("\n")}` : "",
    call.status?.result?.post_summary ? `\nSummary:\n${call.status.result.post_summary}` : "",
    call.status?.result?.transcript ? `\nTranscript:\n${call.status.result.transcript}` : "",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\n")], {type:"text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `voxra-call-${call.id.slice(0,8)}.txt`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PhoneIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  );
}

function SpinnerIcon({ className = "w-5 h-5" }: { className?: string }) {
  return <div className={`${className} border-2 border-brand-400 border-t-transparent rounded-full animate-spin`} />;
}

function CheckCircleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function XCircleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function LogoutIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}

function DownloadIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function TrashIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}

function BookmarkIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
    </svg>
  );
}

function ChartBarIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function WebhookIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  );
}

// ─── Phase label ──────────────────────────────────────────────────────────────

function PhaseLabel({ phase }: { phase: CallPhase }) {
  const map: Record<CallPhase, { label: string; classes: string }> = {
    idle:       { label: "Idle",        classes: "bg-slate-800 text-slate-400 border-slate-700" },
    planning:   { label: "Planning…",   classes: "bg-blue-950 text-blue-300 border-blue-800" },
    clarifying: { label: "Needs Input", classes: "bg-yellow-950 text-yellow-300 border-yellow-800" },
    confirming: { label: "Confirming",  classes: "bg-violet-950 text-violet-300 border-violet-800" },
    running:    { label: "Dialling…",   classes: "bg-amber-950 text-amber-300 border-amber-800" },
    polling:    { label: "In Call",     classes: "bg-emerald-950 text-emerald-300 border-emerald-800 animate-pulse" },
    completed:  { label: "Completed",   classes: "bg-emerald-950 text-emerald-300 border-emerald-800" },
    failed:     { label: "Failed",      classes: "bg-red-950 text-red-300 border-red-900" },
  };
  const { label, classes } = map[phase];
  return (
    <span className={`status-badge border text-xs ${classes}`}>
      {(phase === "planning" || phase === "running" || phase === "polling") && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      )}
      {label}
    </span>
  );
}

// ─── Transcript renderer ──────────────────────────────────────────────────────

function Transcript({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        const isBotLine  = /^\[[\d:]+\] BOT:/i.test(line);
        const isUserLine = /^\[[\d:]+\] USER:/i.test(line);
        const ts   = line.match(/^\[([^\]]+)\]/)?.[1] ?? "";
        const body = line.replace(/^\[[\d:]+\] (BOT|USER):\s*/i, "");
        if (!isBotLine && !isUserLine) {
          return <p key={i} className="text-slate-500 text-xs italic">{line}</p>;
        }
        return (
          <div key={i} className={`flex gap-3 ${isUserLine ? "justify-end" : ""}`}>
            {isBotLine && (
              <span className="shrink-0 self-start mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-brand-900 text-brand-300">BOT</span>
            )}
            <div className={`${isBotLine ? "bubble-bot" : "bubble-user"} rounded-xl px-4 py-2.5 text-sm leading-relaxed max-w-[80%]`}>
              <p>{body}</p>
              <span className="block mt-1 text-[10px] opacity-50">{ts}</span>
            </div>
            {isUserLine && (
              <span className="shrink-0 self-start mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">USER</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Clarifying Questions Form ────────────────────────────────────────────────

function ClarifyingQuestionsForm({
  questions,
  onSubmit,
  onCancel,
}: {
  questions: string[];
  onSubmit: (answers: string[]) => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<string[]>(questions.map(() => ""));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (answers.some((a) => !a.trim())) return;
    onSubmit(answers);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-3 rounded-xl bg-yellow-950/40 border border-yellow-900/50 text-yellow-200 text-xs">
        The agent needs a few more details before placing this call.
      </div>
      {questions.map((q, i) => (
        <div key={i}>
          <label className="label text-xs">{q}</label>
          <input
            type="text"
            className="input-field"
            placeholder="Your answer…"
            value={answers[i]}
            onChange={(e) => {
              const next = [...answers];
              next[i] = e.target.value;
              setAnswers(next);
            }}
            required
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary py-2 px-4 text-sm flex-1" disabled={answers.some((a) => !a.trim())}>
          Continue
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary py-2 px-4 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Call Card ────────────────────────────────────────────────────────────────

function CallCard({
  call,
  onRetry,
  onAnswerClarifying,
  onCancelClarifying,
  showPII,
  userName,
}: {
  call: CallRecord;
  onRetry: (call: CallRecord) => void;
  onAnswerClarifying: (callId: string, answers: string[]) => void;
  onCancelClarifying: (callId: string) => void;
  showPII: boolean;
  userName?: string | null;
}) {
  const [expanded, setExpanded] = useState(
    call.phase === "completed" || call.phase === "failed" || call.phase === "clarifying"
  );

  const callDetails = call.status?.result?.extracted?.calling?.calls?.[0];
  const outcome     = call.status?.result?.outcome;
  const transcript  = call.status?.result?.transcript;
  const summary     = call.status?.result?.post_summary;
  const displayPhone      = showPII ? call.phone : maskPhone(call.phone);
  const displayGoal       = showPII ? call.goal : redactPII(call.goal, userName);
  const displayError      = call.error ? (showPII ? call.error : redactPII(call.error, userName)) : undefined;
  const displaySummary    = summary ? (showPII ? summary : redactPII(summary, userName)) : undefined;
  const displayTranscript = transcript ? (showPII ? transcript : redactPII(transcript, userName)) : undefined;
  const isTerminal = call.phase === "completed" || call.phase === "failed";

  return (
    <div className="glass-card overflow-hidden transition-all duration-200">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-5 text-left hover:bg-surface-hover/30 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-surface-hover border border-surface-border flex items-center justify-center shrink-0 self-start sm:self-auto">
          {call.phase === "completed"
            ? <CheckCircleIcon className="w-5 h-5 text-emerald-400" />
            : call.phase === "failed"
            ? <XCircleIcon className="w-5 h-5 text-red-400" />
            : call.phase === "clarifying"
            ? <span className="text-yellow-400 text-lg">?</span>
            : (call.phase === "planning" || call.phase === "running" || call.phase === "polling")
            ? <SpinnerIcon className="w-5 h-5" />
            : <PhoneIcon className="w-5 h-5 text-slate-400" />
          }
        </div>
        <div className="flex-1 min-w-0 w-full">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-slate-200">{displayPhone}</span>
            <PhaseLabel phase={call.phase} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{displayGoal}</p>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 w-full sm:w-auto">
          {isTerminal && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); exportSingleCallAsText(call); }}
              className="btn-secondary py-1 px-2 text-xs flex items-center gap-1"
              title="Export call"
            >
              <DownloadIcon className="w-3 h-3" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
          {callDetails?.duration_seconds != null && (
            <span className="text-xs text-slate-500">{callDetails.duration_seconds}s</span>
          )}
          <span className="text-xs text-slate-600">{call.createdAt.toLocaleTimeString()}</span>
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-surface-border px-5 pb-5 pt-4 space-y-5">
          {call.phase === "clarifying" && call.clarifying_questions && (
            <ClarifyingQuestionsForm
              questions={call.clarifying_questions}
              onSubmit={(answers) => onAnswerClarifying(call.id, answers)}
              onCancel={() => onCancelClarifying(call.id)}
            />
          )}

          {displayError && call.phase !== "clarifying" && (
            <div className="p-4 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-sm">
              {displayError}
            </div>
          )}

          {call.phase === "failed" && (call.retryCount ?? 0) < 1 && call.status?.status && /NO ANSWER|DECLINED/i.test(call.status.status) && (
            <div className="flex justify-end">
              <button onClick={() => onRetry(call)} className="btn-secondary py-2 px-3 text-xs" type="button">
                Retry Call
              </button>
            </div>
          )}

          {outcome && (
            <div className={`p-4 rounded-xl border text-sm ${
              outcome.task_completed
                ? "bg-emerald-950/30 border-emerald-900/50 text-emerald-200"
                : "bg-amber-950/30 border-amber-900/50 text-amber-200"
            }`}>
              <div className="flex items-center gap-2 font-semibold mb-2">
                {outcome.task_completed ? <CheckCircleIcon className="w-4 h-4" /> : <XCircleIcon className="w-4 h-4" />}
                {outcome.task_completed ? "Task Completed" : "Task Incomplete"}
                <span className="ml-auto text-xs opacity-70">
                  Confidence: {outcome.completion_confidence.label} ({Math.round(outcome.completion_confidence.score * 100)}%)
                </span>
              </div>
              {outcome.evidence && outcome.evidence.length > 0 && (
                <ul className="space-y-1 opacity-80">
                  {outcome.evidence.map((e, i) => (
                    <li key={i} className="text-xs flex gap-2"><span>•</span>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {displaySummary && (
            <div>
              <p className="label">Post-Call Summary</p>
              <p className="text-sm text-slate-300 leading-relaxed">{displaySummary}</p>
            </div>
          )}

          {callDetails && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { k: "Duration", v: callDetails.duration_seconds != null ? `${callDetails.duration_seconds}s` : "—" },
                { k: "Start",    v: callDetails.call_start_time ? new Date(callDetails.call_start_time).toLocaleTimeString() : "—" },
                { k: "End",      v: callDetails.call_end_time   ? new Date(callDetails.call_end_time).toLocaleTimeString()   : "—" },
              ].map(({ k, v }) => (
                <div key={k} className="p-3 rounded-xl bg-surface-hover border border-surface-border text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{k}</p>
                  <p className="text-sm font-semibold text-slate-200">{v}</p>
                </div>
              ))}
            </div>
          )}

          {displayTranscript && (
            <div>
              <p className="label">Transcript</p>
              <div className="p-4 rounded-xl bg-surface-hover/50 border border-surface-border/50">
                <Transcript text={displayTranscript} />
              </div>
            </div>
          )}

          {(call.phase === "running" || call.phase === "polling") && call.status?.message && (
            <div className="flex items-center gap-2 text-xs text-slate-400 p-3 rounded-xl border border-surface-border bg-surface-hover/30">
              <SpinnerIcon className="w-3.5 h-3.5" />
              {call.status.message}
            </div>
          )}

          {call.run_id && (
            <p className="text-[10px] text-slate-600 font-mono">run_id: {call.run_id}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── New Call Form ────────────────────────────────────────────────────────────

function NewCallForm({
  onSubmit,
  busy,
  templates,
  onSaveTemplate,
}: {
  onSubmit: (phone: string, goal: string) => void;
  busy: boolean;
  templates: CallTemplate[];
  onSaveTemplate: (name: string, phone: string, goal: string) => Promise<void>;
}) {
  const [phone, setPhone]               = useState("");
  const [goal, setGoal]                 = useState("");
  const [error, setError]               = useState("");
  const [showPhone, setShowPhone]       = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [saveMsg, setSaveMsg]           = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const p = phone.trim();
    const g = goal.trim();
    if (!p) { setError("Phone number is required."); return; }
    if (!/^\+\d{7,15}$/.test(p)) { setError("Use E.164 format: +14155551234, +601127094706, etc."); return; }
    if (!g) { setError("Please describe what the call is about."); return; }
    onSubmit(p, g);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName.trim() || !goal.trim()) return;
    try {
      await onSaveTemplate(templateName.trim(), phone.trim(), goal.trim());
      setSaveMsg("Template saved.");
      setShowSaveTemplate(false);
      setTemplateName("");
      setTimeout(() => setSaveMsg(""), 3000);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "Failed to save template.");
    }
  };

  const SUGGESTIONS = [
    "Confirm dinner reservation for 2 at 7:00 PM today; if unavailable ask nearest slot between 6:30-8:30 PM; then report final outcome.",
    "Confirm whether order A1029 is out for delivery today; ask ETA window; if delayed ask reason and revised ETA; then summarize.",
    "Ask if they are still planning the Malaysia trip in June; if yes collect travel dates, budget range, and hotel preference; then report details.",
    "Follow up on invoice INV-7841 sent last week; ask planned payment date; if blocked ask reason and next step needed; then summarize.",
    "Confirm tomorrow's 2:00 PM appointment; if no answer leave a brief voicemail asking for callback; then report call result.",
  ];

  return (
    <form onSubmit={handleSubmit} className="glass-card p-6 space-y-5">
      {templates.length > 0 && (
        <div>
          <label className="label">Load a Template</label>
          <select
            className="input-field"
            defaultValue=""
            onChange={(e) => {
              const t = templates.find((t) => t.id === e.target.value);
              if (t) { setGoal(t.goal); if (t.phone) setPhone(t.phone); }
            }}
            disabled={busy}
          >
            <option value="" disabled>Choose a saved template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-sm-between gap-2">
          <label className="label">Phone Number (E.164 format)</label>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowPhone((v) => !v)}>
            {showPhone ? "Hide mobile number" : "Show mobile number"}
          </button>
        </div>
        <input
          type={showPhone ? "tel" : "password"}
          inputMode="tel"
          className="input-field"
          placeholder="+14155551234 or +60112345678"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={busy}
          autoComplete="tel"
        />
        <p className="mt-1.5 text-xs text-slate-500">Include country code — e.g. +1 (US), +60 (MY), +91 (IN), +44 (UK)</p>
      </div>

      <div>
        <label className="label">What should the agent do on the call?</label>
        <textarea
          className="input-field min-h-[110px] resize-y"
          placeholder="Be specific: what to ask, what result you need, and fallback if no one answers.&#10;e.g. Confirm tomorrow's appointment at 2 PM; if no answer leave voicemail; then report outcome."
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          disabled={busy}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowSuggestions((v) => !v)} disabled={busy}>
            {showSuggestions ? "Hide quick templates" : "Quick templates"}
          </button>
          {goal.trim() && !busy && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              onClick={() => setShowSaveTemplate((v) => !v)}
            >
              <BookmarkIcon className="w-3.5 h-3.5" />
              Save as template
            </button>
          )}
        </div>

        {showSuggestions && (
          <div className="mt-2 flex flex-col gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setGoal(s); setShowSuggestions(false); }}
                disabled={busy}
                className="text-xs px-3 py-2 rounded-lg border border-surface-border bg-surface-hover hover:border-brand-700 hover:text-brand-300 text-slate-400 transition-colors text-left"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {showSaveTemplate && (
          <div className="mt-3 p-3 rounded-xl border border-surface-border bg-surface-hover/30 space-y-2">
            <label className="label text-xs">Template name</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-field flex-1 py-1.5 text-sm"
                placeholder="e.g. Appointment confirm"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                maxLength={60}
              />
              <button type="button" onClick={handleSaveTemplate} disabled={!templateName.trim()} className="btn-primary py-1.5 px-3 text-xs">
                Save
              </button>
            </div>
          </div>
        )}
        {saveMsg && <p className="mt-2 text-xs text-emerald-400">{saveMsg}</p>}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-sm flex gap-2 items-center">
          <XCircleIcon className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full py-3.5 text-base" disabled={busy}>
        {busy ? (<><SpinnerIcon className="w-5 h-5" />Processing…</>) : (<><PhoneIcon className="w-5 h-5" />Place Call</>)}
      </button>
    </form>
  );
}

// ─── Batch Call Form ──────────────────────────────────────────────────────────

function BatchCallForm({ onBatchSubmit, busy }: { onBatchSubmit: (entries: Array<{ phone: string; goal: string }>) => void; busy: boolean; }) {
  const [input, setInput]   = useState("");
  const [error, setError]   = useState("");
  const [parsed, setParsed] = useState<Array<{ phone: string; goal: string }>>([]);

  const parseInput = (val: string) => {
    const lines = val.split("\n").map((l) => l.trim()).filter(Boolean);
    const entries: Array<{ phone: string; goal: string }> = [];
    const errs: string[] = [];
    lines.forEach((line, i) => {
      const sep = line.indexOf(",");
      if (sep === -1) { errs.push(`Line ${i + 1}: missing comma separator`); return; }
      const phone = line.slice(0, sep).trim();
      const goal  = line.slice(sep + 1).trim();
      if (!/^\+\d{7,15}$/.test(phone)) { errs.push(`Line ${i + 1}: invalid E.164 phone "${phone}"`); return; }
      if (!goal) { errs.push(`Line ${i + 1}: goal is empty`); return; }
      entries.push({ phone, goal });
    });
    if (errs.length) { setError(errs.join(" • ")); setParsed([]); }
    else { setError(""); setParsed(entries); }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsed.length === 0 || error) return;
    if (parsed.length > 10) { setError("Maximum 10 calls per batch."); return; }
    onBatchSubmit(parsed);
    setInput(""); setParsed([]);
  };

  return (
    <form onSubmit={handleSubmit} className="glass-card p-5 space-y-4">
      <div>
        <label className="label">Batch Calls</label>
        <p className="text-xs text-slate-500 mb-2">One call per line: <code className="text-brand-400">+E164phone, goal description</code></p>
        <textarea
          className="input-field min-h-[120px] resize-y font-mono text-xs"
          placeholder={`+14155551234, Confirm appointment at 2 PM tomorrow\n+60112345678, Check if order #A1029 is dispatched`}
          value={input}
          onChange={(e) => { setInput(e.target.value); parseInput(e.target.value); }}
          disabled={busy}
        />
      </div>
      {error && <div className="p-3 rounded-xl bg-red-950/40 border border-red-900/50 text-red-300 text-xs">{error}</div>}
      {parsed.length > 0 && !error && (
        <div className="text-xs text-emerald-400 flex items-center gap-1.5">
          <CheckCircleIcon className="w-3.5 h-3.5" />
          {parsed.length} call{parsed.length > 1 ? "s" : ""} ready to queue
        </div>
      )}
      <button type="submit" className="btn-primary w-full py-3 text-sm" disabled={busy || parsed.length === 0 || !!error}>
        {busy ? <><SpinnerIcon className="w-4 h-4" />Queuing…</> : <><PhoneIcon className="w-4 h-4" />Queue {parsed.length || ""} Calls</>}
      </button>
    </form>
  );
}

// ─── Analytics Bar ────────────────────────────────────────────────────────────

function AnalyticsBar({ summary }: { summary: AnalyticsSummary | null }) {
  if (!summary || summary.total === 0) return null;
  const completionPct = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;
  return (
    <div className="glass-card p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <ChartBarIcon className="w-4 h-4 text-brand-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Analytics</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Calls",    value: summary.total },
          { label: "Completion",     value: `${completionPct}%` },
          { label: "Avg Confidence", value: summary.avg_confidence != null ? `${summary.avg_confidence}%` : "—" },
          { label: "Avg Duration",   value: summary.avg_duration_seconds != null ? `${summary.avg_duration_seconds}s` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="p-3 rounded-xl bg-surface-hover border border-surface-border text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
            <p className="text-base font-bold text-slate-100">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Templates Panel ──────────────────────────────────────────────────────────

function TemplatesPanel({ templates, onDelete }: { templates: CallTemplate[]; onDelete: (id: string) => void; }) {
  if (templates.length === 0) return null;
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <BookmarkIcon className="w-4 h-4 text-brand-400" />
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Saved Templates</span>
      </div>
      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-surface-border bg-surface-hover/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-300 truncate">{t.name}</p>
              <p className="text-[11px] text-slate-500 truncate mt-0.5">{t.goal}</p>
            </div>
            <button type="button" onClick={() => onDelete(t.id)} className="p-1 rounded text-slate-500 hover:text-red-400 transition-colors shrink-0" title="Delete template">
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Webhook Panel ────────────────────────────────────────────────────────────

function WebhookPanel() {
  const [urlInput, setUrlInput]     = useState("");
  const [configured, setConfigured] = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [msg, setMsg]               = useState("");
  const [open, setOpen]             = useState(false);

  useEffect(() => {
    fetch("/api/settings/webhook")
      .then((r) => r.json())
      .then((d) => { if (d.configured) setConfigured(d.url); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");
    const u = urlInput.trim();
    if (!u) return;
    const res = await fetch("/api/settings/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: u }),
    });
    const d = await res.json();
    if (d.ok) {
      try { const parsed = new URL(u); setConfigured(`${parsed.protocol}//${parsed.host}/***`); } catch { setConfigured("***"); }
      setUrlInput("");
      setMsg("Webhook saved.");
    } else {
      setMsg(d.error ?? "Failed to save webhook.");
    }
    setTimeout(() => setMsg(""), 4000);
  };

  const handleDelete = async () => {
    await fetch("/api/settings/webhook", { method: "DELETE" });
    setConfigured(null);
    setMsg("Webhook removed.");
    setTimeout(() => setMsg(""), 3000);
  };

  if (loading) return null;

  return (
    <div className="glass-card p-4">
      <button type="button" className="w-full flex items-center justify-between" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-2">
          <WebhookIcon className="w-4 h-4 text-brand-400" />
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Webhook</span>
          {configured && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
        </div>
        <svg className={`w-4 h-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">Receive a POST request when a call completes or fails. Must be an HTTPS URL.</p>
          {configured ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-emerald-400 bg-surface-hover rounded px-2 py-1 truncate">{configured}</code>
              <button type="button" onClick={handleDelete} className="btn-secondary py-1 px-2 text-xs">Remove</button>
            </div>
          ) : (
            <form onSubmit={handleSave} className="flex gap-2">
              <input
                type="url"
                className="input-field flex-1 py-1.5 text-sm"
                placeholder="https://your-server.com/webhook"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
              />
              <button type="submit" disabled={!urlInput.trim()} className="btn-primary py-1.5 px-3 text-xs">Save</button>
            </form>
          )}
          {msg && <p className="text-xs text-emerald-400">{msg}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, status, signOut } = useAuth();
  const router = useRouter();

  const [calls, setCalls]         = useState<CallRecord[]>([]);
  const [busy, setBusy]           = useState(false);
  const [showPII, setShowPII]     = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [templates, setTemplates] = useState<CallTemplate[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const pollingRef   = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const pollMetaRef  = useRef<Record<string, { startedAt: number; attempts: number }>>({});
  const savedCallIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  // Load history + templates + analytics on mount
  useEffect(() => {
    if (status !== "authenticated" || historyLoaded) return;
    setHistoryLoaded(true);

    fetch("/api/calls/history")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.records) && d.records.length > 0) {
          const persisted: CallRecord[] = d.records.map((r: {
            id: string; phone: string; goal: string; run_id?: string;
            phase: CallPhase; createdAt: string; error?: string;
          }) => ({ ...r, createdAt: new Date(r.createdAt), retryCount: 0 }));
          persisted.forEach((c) => savedCallIds.current.add(c.id));
          setCalls(persisted);
        }
      })
      .catch(() => {});

    fetch("/api/calls/templates")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.templates)) setTemplates(d.templates); })
      .catch(() => {});

    fetch("/api/analytics/summary")
      .then((r) => r.json())
      .then((d) => { if (d.summary) setAnalytics(d.summary); })
      .catch(() => {});
  }, [status, historyLoaded]);

  // Persist terminal calls to Redis
  useEffect(() => {
    const terminalCalls = calls.filter(
      (c) => (c.phase === "completed" || c.phase === "failed") && !savedCallIds.current.has(c.id)
    );
    if (terminalCalls.length === 0) return;
    terminalCalls.forEach((call) => {
      savedCallIds.current.add(call.id);
      const cd = call.status?.result?.extracted?.calling?.calls?.[0];
      fetch("/api/calls/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: call.id, phone: call.phone, goal: call.goal, run_id: call.run_id,
          phase: call.phase, createdAt: call.createdAt.toISOString(), error: call.error,
          outcome: call.status?.result?.outcome ?? null,
          post_summary: call.status?.result?.post_summary ?? null,
          transcript: call.status?.result?.transcript ?? null,
          duration_seconds: cd?.duration_seconds ?? null,
        }),
      }).catch(() => {});
    });
    setTimeout(() => {
      fetch("/api/analytics/summary").then((r) => r.json()).then((d) => { if (d.summary) setAnalytics(d.summary); }).catch(() => {});
    }, 1000);
  }, [calls]);

  // ── Polling ──────────────────────────────────────────────────────────────

  const stopPolling = useCallback((id: string) => {
    if (pollingRef.current[id]) { clearInterval(pollingRef.current[id]); delete pollingRef.current[id]; }
    const initKey = `${id}_init`;
    if (pollingRef.current[initKey]) { clearTimeout(pollingRef.current[initKey] as unknown as ReturnType<typeof setTimeout>); delete pollingRef.current[initKey]; }
    delete pollMetaRef.current[id];
  }, []);

  const pollStatus = useCallback(async (recordId: string, runId: string) => {
    try {
      const meta = pollMetaRef.current[recordId];
      if (meta) {
        meta.attempts += 1;
        if (Date.now() - meta.startedAt > 10 * 60 * 1000 || meta.attempts > 150) {
          stopPolling(recordId);
          setCalls((prev) => prev.map((c) => c.id === recordId ? { ...c, phase: "failed", error: "Call status timed out." } : c));
          return;
        }
      }
      const res = await fetch(`/api/calls/status/${runId}`);
      if (res.status === 401) { stopPolling(recordId); router.push("/"); return; }
      if (!res.ok) return;
      const data: StatusResult = await res.json();
      const upper = data.status.toUpperCase();
      const terminal = ["COMPLETED","FAILED","NO ANSWER","DECLINED","FINISHED"].some((s) => upper.includes(s)) || data.next_step?.action === "report_result";
      const noAnswer = /NO ANSWER|DECLINED/i.test(upper);
      setCalls((prev) => prev.map((c) =>
        c.id === recordId
          ? {
              ...c, status: data,
              phase: terminal ? (upper.includes("FAIL") || noAnswer ? "failed" : "completed") : "polling",
              error: terminal && noAnswer ? "No answer or call declined. You can retry once." : c.error,
            }
          : c
      ));
      if (terminal) stopPolling(recordId);
    } catch { /* swallow */ }
  }, [stopPolling, router]);

  const startPolling = useCallback((recordId: string, runId: string) => {
    pollMetaRef.current[recordId] = { startedAt: Date.now(), attempts: 0 };
    const timer = setTimeout(() => {
      pollStatus(recordId, runId);
      pollingRef.current[recordId] = setInterval(() => pollStatus(recordId, runId), 4_000);
    }, 4_000);
    pollingRef.current[`${recordId}_init`] = timer as unknown as ReturnType<typeof setInterval>;
  }, [pollStatus]);

  useEffect(() => {
    const ref = pollingRef.current;
    return () => { Object.values(ref).forEach(clearInterval); };
  }, []);

  // ── Core call execution ───────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const executeCall = useCallback(async (phone: string, goal: string, recordId: string, retryCount = 0) => {
    setCalls((prev) => prev.map((c) => c.id === recordId ? { ...c, phase: "planning" } : c));
    try {
      const planRes = await fetch("/api/calls/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, goal }),
      });
      const planData: PlanResult & { error?: string } = await planRes.json();
      if (!planRes.ok || planData.error) throw new Error(planData.error ?? "Failed to create call plan");

      if (!planData.confirm_token) {
        if (planData.clarifying_questions && planData.clarifying_questions.length > 0) {
          setCalls((prev) => prev.map((c) =>
            c.id === recordId ? { ...c, phase: "clarifying", clarifying_questions: planData.clarifying_questions, planResult: planData } : c
          ));
          return;
        }
        throw new Error("Failed to create call plan: missing confirm_token.");
      }

      setCalls((prev) => prev.map((c) => c.id === recordId ? { ...c, phase: "running", error: undefined } : c));
      const runRes = await fetch("/api/calls/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planData.plan_id, confirm_token: planData.confirm_token }),
      });
      const runData: { run_id?: string; error?: string } = await runRes.json();
      if (!runRes.ok || runData.error) throw new Error(runData.error ?? "Failed to start call");

      const runId = runData.run_id!;
      setCalls((prev) => prev.map((c) => c.id === recordId ? { ...c, run_id: runId, phase: "polling" } : c));
      startPolling(recordId, runId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setCalls((prev) => prev.map((c) => c.id === recordId ? { ...c, phase: "failed", error: msg } : c));
    }
  }, [startPolling]);

  const handleCall = useCallback(async (phone: string, goal: string, retryCount = 0) => {
    setBusy(true);
    const recordId = crypto.randomUUID();
    setCalls((prev) => [{ id: recordId, phone, goal, phase: "planning", createdAt: new Date(), retryCount }, ...prev]);
    try { await executeCall(phone, goal, recordId, retryCount); }
    finally { setBusy(false); }
  }, [executeCall]);

  const handleBatchSubmit = useCallback(async (entries: Array<{ phone: string; goal: string }>) => {
    setBusy(true);
    try {
      const items = entries.map((e) => ({ id: crypto.randomUUID(), phone: e.phone, goal: e.goal, phase: "planning" as CallPhase, createdAt: new Date(), retryCount: 0 }));
      setCalls((prev) => [...items, ...prev]);
      for (const item of items) {
        await executeCall(item.phone, item.goal, item.id);
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally { setBusy(false); }
  }, [executeCall]);

  const handleRetry = useCallback((call: CallRecord) => {
    if ((call.retryCount ?? 0) >= 1 || busy) return;
    setCalls((prev) => prev.filter((c) => c.id !== call.id));
    void handleCall(call.phone, call.goal, (call.retryCount ?? 0) + 1);
  }, [busy, handleCall]);

  const handleAnswerClarifying = useCallback(async (callId: string, answers: string[]) => {
    const call = calls.find((c) => c.id === callId);
    if (!call || !call.clarifying_questions) return;
    const enriched = [call.goal, ...call.clarifying_questions.map((q, i) => `${q}: ${answers[i] ?? ""}`)].join(". ");
    setCalls((prev) => prev.map((c) => c.id === callId ? { ...c, goal: enriched, phase: "planning", clarifying_questions: undefined } : c));
    await executeCall(call.phone, enriched, callId);
  }, [calls, executeCall]);

  const handleCancelClarifying = useCallback((callId: string) => {
    setCalls((prev) => prev.map((c) => c.id === callId ? { ...c, phase: "failed", error: "Cancelled by user." } : c));
  }, []);

  const handleSaveTemplate = useCallback(async (name: string, phone: string, goal: string) => {
    const res = await fetch("/api/calls/templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, goal }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? "Failed to save template");
    setTemplates((prev) => [...prev, d.template]);
  }, []);

  const handleDeleteTemplate = useCallback(async (id: string) => {
    await fetch(`/api/calls/templates/${id}`, { method: "DELETE" });
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return null;

  const activeCalls    = calls.filter((c) => ["planning","clarifying","running","polling"].includes(c.phase));
  const completedCalls = calls.filter((c) => c.phase === "completed" || c.phase === "failed");

  return (
    <div className="min-vh-100 bg-surface">
      <nav
        className="navbar sticky-top border-bottom border-secondary-subtle"
        style={{ backdropFilter: "blur(8px)", background: "rgba(15, 23, 42, 0.92)" }}
      >
        <div className="container-fluid container-xl py-2">
          <div className="d-flex align-items-center gap-2">
            <div
              className="rounded-3 d-flex align-items-center justify-content-center"
              style={{ width: 30, height: 30, background: "linear-gradient(135deg, #2563eb 0%, #06b6d4 100%)" }}
            >
              <PhoneIcon className="w-4 h-4 text-white" />
            </div>
            <span className="fw-semibold text-light">Voxra Ops</span>
          </div>
          <div className="d-flex align-items-center gap-2 gap-md-3 flex-wrap justify-content-end">
            <button onClick={() => setShowPII((v) => !v)} className="btn btn-outline-light btn-sm" type="button">
              {showPII ? "Hide PII" : "Show PII"}
            </button>
            {activeCalls.length > 0 && (
              <span className="badge text-bg-success rounded-pill px-3 py-2">{activeCalls.length} active</span>
            )}
            {completedCalls.length > 0 && (
              <button type="button" className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1" onClick={() => exportCallsAsCSV(completedCalls)}>
                <DownloadIcon className="w-3.5 h-3.5" />
                <span className="d-none d-sm-inline">Export All</span>
              </button>
            )}
            {showPII && user?.picture && (
              <Image src={user.picture} alt={user.name ?? "User"} width={30} height={30} className="rounded-circle border border-secondary" />
            )}
            <span className="text-light small d-none d-md-inline">{showPII ? user?.name : "[name]"}</span>
            <button
              onClick={async () => { await signOut(); router.push("/"); }}
              className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
              type="button"
            >
              <LogoutIcon className="w-4 h-4" />
              <span className="d-none d-sm-inline">Sign out</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="container-fluid container-xl py-4 py-md-5">
        <div className="mb-4 mb-md-5">
          <h1 className="h3 text-light fw-bold mb-1">
            Operations command center, {showPII ? (user?.name?.split(" ")[0] ?? "operator") : "[name]"}.
          </h1>
          <p className="text-secondary mb-0">Launch calls, monitor execution, and review structured outcomes from one workspace.</p>
        </div>

        <AnalyticsBar summary={analytics} />

        <div className="row g-4 align-items-start">
          <div className="col-12 col-lg-8 order-2 order-lg-1">
            <div className="d-flex flex-column gap-3">
              {activeCalls.length > 0 && (
                <section>
                  <h2 className="text-uppercase text-secondary small fw-bold mb-3">Active Calls</h2>
                  <div className="d-flex flex-column gap-3">
                    {activeCalls.map((c) => (
                      <CallCard key={c.id} call={c} onRetry={handleRetry} onAnswerClarifying={handleAnswerClarifying} onCancelClarifying={handleCancelClarifying} showPII={showPII} userName={user?.name} />
                    ))}
                  </div>
                </section>
              )}
              {completedCalls.length > 0 && (
                <section>
                  <div className="d-flex align-items-center justify-content-between mb-3">
                    <h2 className="text-uppercase text-secondary small fw-bold mb-0">History</h2>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm d-flex align-items-center gap-1"
                      onClick={async () => {
                        if (!confirm("Clear all call history?")) return;
                        await fetch("/api/calls/history", { method: "DELETE" });
                        setCalls((prev) => prev.filter((c) => ["planning","clarifying","running","polling"].includes(c.phase)));
                        setAnalytics(null);
                      }}
                    >
                      <TrashIcon className="w-3.5 h-3.5" />
                      <span className="d-none d-sm-inline">Clear history</span>
                    </button>
                  </div>
                  <div className="d-flex flex-column gap-3">
                    {completedCalls.map((c) => (
                      <CallCard key={c.id} call={c} onRetry={handleRetry} onAnswerClarifying={handleAnswerClarifying} onCancelClarifying={handleCancelClarifying} showPII={showPII} userName={user?.name} />
                    ))}
                  </div>
                </section>
              )}
              {calls.length === 0 && (
                <div className="glass-card p-5 text-center">
                  <div className="mx-auto mb-3 rounded-3 d-flex align-items-center justify-content-center" style={{ width: 56, height: 56, background: "rgba(30,41,59,0.7)", border: "1px solid rgba(100,116,139,0.35)" }}>
                    <PhoneIcon className="w-6 h-6 text-slate-500" />
                  </div>
                  <h3 className="h6 text-light fw-semibold">No calls yet</h3>
                  <p className="text-secondary mb-0">Create your first call workflow from the panel on the right.</p>
                </div>
              )}
            </div>
          </div>

          <div className="col-12 col-lg-4 order-1 order-lg-2">
            <div className="d-flex flex-column gap-3">
              <div className="d-flex align-items-center justify-content-between">
                <h2 className="text-uppercase text-secondary small fw-bold mb-0">{showBatch ? "Batch Calls" : "New Call"}</h2>
                <div className="d-flex gap-2">
                  <button type="button" className={`btn btn-sm ${showBatch ? "btn-outline-secondary" : "btn-outline-light"}`} onClick={() => setShowBatch(false)}>Single</button>
                  <button type="button" className={`btn btn-sm ${showBatch ? "btn-outline-light" : "btn-outline-secondary"}`} onClick={() => setShowBatch(true)}>Batch</button>
                </div>
              </div>
              {showBatch
                ? <BatchCallForm onBatchSubmit={handleBatchSubmit} busy={busy} />
                : <NewCallForm onSubmit={handleCall} busy={busy} templates={templates} onSaveTemplate={handleSaveTemplate} />
              }
              <TemplatesPanel templates={templates} onDelete={handleDeleteTemplate} />
              <WebhookPanel />
              <div className="glass-card p-4">
                <h3 className="text-uppercase text-secondary small fw-bold mb-3">Execution Playbook</h3>
                <ol className="list-group list-group-numbered">
                  {[
                    "Use international format with country code for reliable routing.",
                    "Define the exact call outcome and fallback behavior.",
                    "Let Voxra execute with adaptive, policy-safe dialogue.",
                    "Review transcript, evidence, and confidence for next actions.",
                  ].map((step, i) => (
                    <li key={i} className="list-group-item bg-transparent border-secondary-subtle text-secondary">{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
