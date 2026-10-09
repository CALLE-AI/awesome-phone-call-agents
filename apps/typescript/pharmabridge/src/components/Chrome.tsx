"use client";
import { Activity, Archive, Check } from "lucide-react";
import Link from "next/link";
import type { AppConfig } from "@/lib/types";
import { cx } from "@/lib/ui";

export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora absolute -left-[12%] -top-[22%] h-[60vh] w-[55vw] rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="aurora absolute -right-[10%] top-[4%] h-[55vh] w-[45vw] rounded-full bg-fuchsia-200/45 blur-3xl [animation-delay:-7s]" />
      <div className="aurora absolute bottom-[-28%] left-[25%] h-[50vh] w-[50vw] rounded-full bg-amber-100/70 blur-3xl [animation-delay:-13s]" />
      <div className="aurora absolute bottom-[5%] right-[-8%] h-[40vh] w-[35vw] rounded-full bg-sky-200/40 blur-3xl [animation-delay:-4s]" />
      <div className="dot-grid absolute inset-0" />
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cx("h-9 w-9 drop-shadow-[0_6px_14px_rgba(168,85,247,0.35)]", className)} aria-hidden>
      <defs>
        <linearGradient id="pb-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="0.45" stopColor="#A855F7" />
          <stop offset="0.75" stopColor="#EC4899" />
          <stop offset="1" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#pb-logo)" />
      <path d="M10 32c3.4-8.2 8.3-12.6 14-12.6S34.6 23.8 38 32" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M17 32v-4.5M24 32v-7.5M31 32v-4.5" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="24" cy="12.5" r="2.8" fill="#fff" />
    </svg>
  );
}

const STEPS = ["Need", "Facilities", "Dispatch", "Secure"];

export function TopBar({ config, step, maxStep, onStep }: { config: AppConfig | null; step?: number; maxStep?: number; onStep?: (step: number) => void }) {
  return (
    <header className="sticky top-0 z-[1100] border-b border-slate-200/70 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="flex items-center gap-3">
          <Logo />
          <div>
            <div className="font-display text-[17px] font-bold leading-tight tracking-tight text-slate-900">
              Pharma<span className="brand-text">Bridge</span>
            </div>
            <div className="text-[10.5px] font-medium text-slate-500">Critical medicine & blood, found by phone</div>
          </div>
        </Link>

        {step && onStep ? (
          <nav className="hidden items-center gap-1 rounded-2xl bg-slate-100/80 p-1 md:flex" aria-label="Progress">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const reachable = n <= (maxStep ?? 1);
              const active = n === step;
              return (
                <button
                  key={label}
                  disabled={!reachable}
                  onClick={() => onStep(n)}
                  className={cx(
                    "flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition",
                    active ? "bg-white text-slate-900 shadow-sm" : reachable ? "text-slate-600 hover:text-slate-900" : "text-slate-400",
                  )}
                >
                  <span
                    className={cx(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                      n < step ? "bg-emerald-500 text-white" : active ? "brand-bg text-white" : "bg-white text-slate-400 ring-1 ring-slate-200",
                    )}
                  >
                    {n < step ? <Check className="h-3 w-3" /> : n}
                  </span>
                  {label}
                </button>
              );
            })}
          </nav>
        ) : null}

        <div className="flex items-center gap-2">
          <Link
            href="/pulse"
            className="hidden items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:inline-flex"
          >
            <Activity className="h-4 w-4 text-emerald-500" /> Shortage Pulse
          </Link>
          {config?.recordsEnabled && (
            <Link
              href="/records"
              className="hidden items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:inline-flex"
            >
              <Archive className="h-4 w-4" /> Call records
            </Link>
          )}
          <ModeBadge config={config} />
        </div>
      </div>
    </header>
  );
}

export function ModeBadge({ config }: { config: AppConfig | null }) {
  if (!config) return <span className="text-[11px] text-slate-400">connecting…</span>;
  const live = config.liveEnabled;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1",
        live ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-blue-50 text-blue-700 ring-blue-200",
      )}
    >
      <span className={cx("live-dot h-2 w-2 rounded-full", live ? "bg-emerald-500" : "bg-blue-500")} />
      {live ? `Agents ready · ${config.liveCallsToday}/${config.dailyCap} today` : "Agents ready"}
    </span>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto mt-16 max-w-7xl px-5 pb-10 text-[11.5px] leading-relaxed text-slate-500">
      <div className="flex flex-col gap-2 border-t border-slate-200/80 pt-6 md:flex-row md:items-center md:justify-between">
        <p>
          Calls by <span className="font-semibold text-slate-700">CALL-E</span> · Drug data: NLM RxNorm, openFDA · Map data © OpenStreetMap contributors
        </p>
        <p>PharmaBridge checks availability only. It never gives medical advice or changes a prescription or blood order.</p>
      </div>
    </footer>
  );
}
