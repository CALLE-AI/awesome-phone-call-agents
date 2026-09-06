"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { basisColor } from "@/components/reading";
import { forgetAll, list, rowReason, type QueueEntry } from "@/lib/queue";

type Filter = "needs a person" | "everything";

export default function QueuePage() {
  const [entries, setEntries] = useState<QueueEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("needs a person");

  useEffect(() => setEntries(list()), []);

  if (entries === null) {
    return <Empty title="Loading the queue." body="This lives in your browser, so it takes a moment to read." />;
  }

  if (entries.length === 0) {
    return (
      <Empty
        title="Nothing read yet."
        body="Everything you read lands here, newest first, with the reason it needs a person on the row. Read one and come back."
        cta
      />
    );
  }

  const waiting = entries.filter((entry) => entry.disposition.needsHuman);
  const shown = filter === "needs a person" ? waiting : entries;

  return (
    <main>
      <header
        className="flex flex-col gap-8 border-b px-6 py-10 md:px-12 lg:flex-row lg:items-end lg:justify-between lg:px-16 lg:py-12"
        style={{ borderColor: "var(--rule)" }}
      >
        <div>
          <h1 className="min-w-0 text-4xl leading-[1.05] font-medium sm:text-5xl">
            {waiting.length} of {entries.length} need{waiting.length === 1 ? "s" : ""} a person.
          </h1>
          <p className="mt-4 max-w-[60ch] text-[15px]" style={{ color: "var(--paper-dim)" }}>
            The reason is on the row, so nobody has to open a call to triage it. Kept in this
            browser and nowhere else.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-6">
          {(["needs a person", "everything"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className="font-mono text-xs tracking-[0.16em] uppercase"
              style={{
                color: filter === option ? "var(--paper)" : "var(--paper-faint)",
                textDecoration: filter === option ? "underline" : "none",
                textUnderlineOffset: "6px",
              }}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              forgetAll();
              setEntries([]);
            }}
            className="font-mono text-xs tracking-[0.16em] uppercase"
            style={{ color: "var(--paper-faint)" }}
          >
            clear
          </button>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="px-6 py-16 text-lg md:px-12 lg:px-16" style={{ color: "var(--paper-dim)" }}>
          Nothing in the queue needs a person. Every reading is a stated fact and they agree.
        </p>
      ) : (
        <ul>
          {shown.map((entry) => (
            <Row key={entry.key} entry={entry} />
          ))}
        </ul>
      )}
    </main>
  );
}

function Row({ entry }: { entry: QueueEntry }) {
  const alarming = entry.disposition.needsHuman;
  const extra = Math.max(entry.disposition.reasons.length - 1, 0);

  return (
    <li className="border-b" style={{ borderColor: "var(--rule)" }}>
      <Link
        href={`/queue/${entry.key}`}
        className="group grid grid-cols-1 gap-x-10 gap-y-4 px-6 py-7 md:px-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] lg:items-baseline lg:px-16"
        style={{ borderLeft: `3px solid ${alarming ? "var(--alarm)" : "var(--quoted)"}` }}
      >
        <span>
          <span className="block text-[17px] leading-snug group-hover:text-[var(--derived)]">
            {entry.spoken.headline}
          </span>
          <span
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs"
            style={{ color: "var(--paper-faint)" }}
          >
            <span>{entry.disposition.surface}</span>
            <span>{entry.callId ?? "no call id"}</span>
            <span>{new Date(entry.at).toLocaleTimeString()}</span>
          </span>
        </span>

        <span className="text-[15px] leading-relaxed" style={{ color: "var(--paper-dim)" }}>
          {rowReason(entry)}
          {extra > 0 ? (
            <span style={{ color: "var(--paper-faint)" }}>
              {" "}
              and {extra} more {extra === 1 ? "reason" : "reasons"}
            </span>
          ) : null}
        </span>

        <span className="flex gap-3 font-mono text-[10px] tracking-[0.14em] uppercase lg:justify-end">
          {(["endstate", "taskOutcome", "resultState"] as const).map((axis) => (
            <span
              key={axis}
              title={`${axis}: ${entry.disposition[axis].value}`}
              style={{ color: basisColor(entry.disposition[axis].basis) }}
            >
              {entry.disposition[axis].basis.slice(0, 3)}
            </span>
          ))}
        </span>
      </Link>
    </li>
  );
}

function Empty({ title, body, cta }: { title: string; body: string; cta?: boolean }) {
  return (
    <main className="px-6 py-20 md:px-12 lg:px-16">
      <h1 className="max-w-[20ch] text-4xl leading-[1.05] font-medium sm:text-5xl">{title}</h1>
      <p className="mt-6 max-w-[54ch] text-lg" style={{ color: "var(--paper-dim)" }}>
        {body}
      </p>
      {cta ? (
        <Link
          href="/"
          className="mt-8 inline-block border px-6 py-3 font-mono text-xs tracking-[0.18em] uppercase"
          style={{ borderColor: "var(--paper)" }}
        >
          read one
        </Link>
      ) : null}
    </main>
  );
}
