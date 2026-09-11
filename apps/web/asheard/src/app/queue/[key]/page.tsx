"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Payload, Readings, Verdict } from "@/components/reading";
import { find, forget, type QueueEntry } from "@/lib/queue";

export default function QueueEntryPage() {
  const params = useParams<{ key: string }>();
  const [entry, setEntry] = useState<QueueEntry | null | undefined>(undefined);
  const [cited, setCited] = useState<readonly string[]>([]);

  useEffect(() => setEntry(find(params.key)), [params.key]);

  if (entry === undefined) return null;

  if (entry === null) {
    return (
      <main className="px-6 py-20 md:px-12 lg:px-16">
        <h1 className="max-w-[22ch] text-4xl leading-[1.05] font-medium sm:text-5xl">
          That one is not in this browser.
        </h1>
        <p className="mt-6 max-w-[56ch] text-lg" style={{ color: "var(--paper-dim)" }}>
          The queue lives in local storage, so a link to a reading only opens on the machine that
          read it. That is the trade for storing nothing.
        </p>
        <Link
          href="/queue"
          className="mt-8 inline-block border px-6 py-3 font-mono text-xs tracking-[0.18em] uppercase"
          style={{ borderColor: "var(--paper)" }}
        >
          back to the queue
        </Link>
      </main>
    );
  }

  return (
    <main>
      <Verdict
        spoken={entry.spoken}
        aside={
          <span className="font-mono text-xs" style={{ color: "var(--paper-faint)" }}>
            {entry.callId ?? "no call id"} · {new Date(entry.at).toLocaleString()}
          </span>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="border-b px-6 py-10 md:px-12 lg:border-r lg:border-b-0 lg:px-16 lg:py-14" style={{ borderColor: "var(--rule)" }}>
          <Readings disposition={entry.disposition} onHover={setCited} />

          <div className="mt-14 flex flex-wrap items-center gap-6">
            <Link
              href="/queue"
              className="font-mono text-xs tracking-[0.16em] uppercase underline underline-offset-4"
              style={{ color: "var(--paper-faint)" }}
            >
              back to the queue
            </Link>
            <button
              type="button"
              onClick={() => {
                forget(entry.key);
                window.location.href = "/queue";
              }}
              className="font-mono text-xs tracking-[0.16em] uppercase underline underline-offset-4"
              style={{ color: "var(--paper-faint)" }}
            >
              drop it
            </button>
          </div>
        </section>

        <aside className="px-6 py-10 md:px-12 lg:px-10 lg:py-14">
          <Payload payload={entry.payload} cited={cited} />
        </aside>
      </div>
    </main>
  );
}
