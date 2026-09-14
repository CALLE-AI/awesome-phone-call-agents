"use client";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/ui";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card rounded-3xl", className)}>{children}</div>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "blood" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  icon?: ReactNode;
};

const BUTTON_STYLES = {
  primary:
    "brand-bg text-white shadow-[0_12px_30px_-12px_rgba(168,85,247,0.7)] hover:shadow-[0_16px_36px_-12px_rgba(236,72,153,0.65)] hover:brightness-[1.06]",
  blood: "blood-bg text-white shadow-[0_12px_30px_-12px_rgba(244,63,94,0.65)] hover:brightness-[1.06]",
  secondary: "bg-white text-slate-800 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100",
};

export function Button({ variant = "primary", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
        BUTTON_STYLES[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

const TONES = {
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  white: "bg-white text-slate-700 ring-slate-200",
};

export type Tone = keyof typeof TONES;

export function Chip({ tone = "slate", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Call mode marker: green for a call CALL-E placed, blue for one PharmaBridge ran itself. Unlabeled on purpose. */
export function ModeDot({ live, className }: { live: boolean; className?: string }) {
  return <span aria-hidden className={cx("inline-block h-2 w-2 shrink-0 rounded-full", live ? "bg-emerald-500" : "bg-blue-500", className)} />;
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{children}</span>
      {hint ? <span className="text-[11px] text-slate-400">{hint}</span> : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; hint?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.hint}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
            value === option.value ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
            option.disabled && "cursor-not-allowed opacity-40",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Waveform({ active, color = "#8b5cf6", bars = 7 }: { active: boolean; color?: string; bars?: number }) {
  return (
    <div className="flex h-5 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cx("h-full w-[3px] rounded-full", active && "wave-bar")}
          style={{ background: color, opacity: active ? 0.9 : 0.25, animationDelay: `${i * 0.11}s`, transform: active ? undefined : "scaleY(0.3)" }}
        />
      ))}
    </div>
  );
}

export function ConfidenceMeter({ score, label }: { score: number | null | undefined; label?: string | null }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  return (
    <div className="flex items-center gap-2" title="Completion confidence">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <div className="brand-bg h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[10px] text-slate-500">
        {pct}% {label ?? ""}
      </span>
    </div>
  );
}

export function Stat({ value, label, accent, icon }: { value: ReactNode; label: ReactNode; accent?: boolean; icon?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {icon ? <div className="mt-0.5">{icon}</div> : null}
      <div>
        <div className={cx("font-display text-2xl font-semibold tabular-nums tracking-tight", accent ? "brand-text" : "text-slate-900")}>{value}</div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{label}</div>
      </div>
    </div>
  );
}

export function IconBubble({ children, tone = "violet", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <div className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", TONES[tone], className)}>{children}</div>;
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" />
      <span>{children}</span>
    </label>
  );
}
