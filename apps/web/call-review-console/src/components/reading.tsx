"use client";

import type { AxisReading, Basis, Disposition, Spoken } from "asheard/disposition";

import { isCited, toJsonLines } from "@/lib/json-lines";

export const AXES = [
  { key: "endstate", label: "how it ended" },
  { key: "taskOutcome", label: "did the job get done" },
  { key: "resultState", label: "did usable data come back" },
] as const;

const BASIS_COPY: Record<Basis, string> = {
  quoted: "the source said so outright",
  derived: "worked out from other fields",
  absent: "the source cannot express this at all",
};

export function basisColor(basis: Basis): string {
  if (basis === "quoted") return "var(--quoted)";
  if (basis === "derived") return "var(--derived)";
  return "var(--absent)";
}

export function Verdict({ spoken, aside }: { spoken: Spoken; aside?: React.ReactNode }) {
  const alarming = spoken.verdict === "review";
  return (
    <header
      className="border-b px-6 py-10 md:px-12 lg:px-16 lg:py-14"
      style={{
        borderColor: "var(--rule)",
        borderLeft: `4px solid ${alarming ? "var(--alarm)" : "var(--quoted)"}`,
      }}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <h1 className="min-w-0 flex-1 text-3xl leading-[1.1] font-medium sm:text-5xl lg:text-6xl">
          {spoken.headline}
        </h1>
        <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
          <p
            className="font-mono text-xs tracking-[0.2em] uppercase"
            style={{ color: alarming ? "var(--alarm)" : "var(--quoted)" }}
          >
            {alarming ? "needs a person" : "safe to act on"}
          </p>
          {aside}
        </div>
      </div>
      {spoken.subline ? (
        <p className="mt-6 max-w-[70ch] text-lg" style={{ color: "var(--paper-dim)" }}>
          {spoken.subline}
        </p>
      ) : null}
    </header>
  );
}

export function Readings({
  disposition,
  onHover,
}: {
  disposition: Disposition;
  onHover: (cited: readonly string[]) => void;
}) {
  return (
    <div onMouseLeave={() => onHover([])}>
      <p
        className="font-mono text-xs tracking-[0.2em] uppercase"
        style={{ color: "var(--paper-faint)" }}
      >
        {disposition.surface}
      </p>

      <dl className="mt-10 flex flex-col gap-12">
        {AXES.map(({ key, label }) => {
          const axis = disposition[key] as AxisReading<string>;
          return (
            <div key={key} onMouseEnter={() => onHover(axis.from)} className="cursor-default">
              <dt
                className="font-mono text-xs tracking-[0.18em] uppercase"
                style={{ color: "var(--paper-faint)" }}
              >
                {label}
              </dt>
              <dd className="mt-3">
                <span className="font-mono text-2xl sm:text-3xl">{axis.value}</span>
                <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className="font-mono text-xs tracking-[0.16em] uppercase"
                    style={{ color: basisColor(axis.basis) }}
                  >
                    {axis.basis}
                  </span>
                  <span className="text-sm" style={{ color: "var(--paper-faint)" }}>
                    {BASIS_COPY[axis.basis]}
                  </span>
                </span>
                <span className="mt-3 block font-mono text-xs" style={{ color: "var(--paper-dim)" }}>
                  {axis.from.join(", ")}
                </span>
                <p
                  className="mt-4 max-w-[62ch] text-[15px] leading-relaxed"
                  style={{ color: "var(--paper-dim)" }}
                >
                  {axis.note}
                </p>
              </dd>
            </div>
          );
        })}
      </dl>

      {disposition.reasons.length > 0 ? (
        <div className="mt-14 border-t pt-8" style={{ borderColor: "var(--rule)" }}>
          <p
            className="font-mono text-xs tracking-[0.18em] uppercase"
            style={{ color: "var(--alarm)" }}
          >
            why a person has to look
          </p>
          <ul className="mt-5 flex flex-col gap-4">
            {disposition.reasons.map((reason) => (
              <li
                key={reason}
                className="max-w-[70ch] border-l-2 pl-4 text-[15px] leading-relaxed"
                style={{ borderColor: "var(--alarm)", color: "var(--paper-dim)" }}
              >
                {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function Payload({
  payload,
  cited,
  action,
}: {
  payload: unknown;
  cited: readonly string[];
  action?: React.ReactNode;
}) {
  const lines = toJsonLines(payload);
  return (
    <div className="lg:sticky lg:top-8">
      <div className="flex items-baseline justify-between gap-4">
        <p
          className="font-mono text-xs tracking-[0.2em] uppercase"
          style={{ color: "var(--paper-faint)" }}
        >
          what it read
        </p>
        {action}
      </div>

      <pre className="payload mt-5 max-h-[70vh] overflow-auto font-mono text-[12px] leading-[1.7]">
        {lines.map((line, index) => {
          const lit = isCited(line, cited);
          return (
            <div
              key={index}
              style={{
                background: lit ? "color-mix(in srgb, var(--derived) 16%, transparent)" : undefined,
                color: lit ? "var(--paper)" : "var(--paper-dim)",
                paddingLeft: `${line.indent * 1.25 + 0.75}rem`,
                borderLeft: `2px solid ${lit ? "var(--derived)" : "transparent"}`,
              }}
            >
              {line.text}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
