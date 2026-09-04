"use client";

import { useCallback, useEffect, useState } from "react";
import type { Disposition, Spoken } from "asheard/disposition";

import { basisColor } from "@/components/reading";

interface Arrival {
  at: string;
  payload: unknown;
  reading: { disposition: Disposition; spoken: Spoken } | null;
  unreadable: string | null;
}

const INBOX_KEY = "asheard.inbox.v1";

function makeInbox(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadInbox(): string {
  try {
    const existing = window.localStorage.getItem(INBOX_KEY);
    if (existing && /^[0-9a-f]{32}$/.test(existing)) return existing;
  } catch {
    // Storage blocked. A fresh inbox every visit is worse than a stable one,
    // but it still works, so carry on.
  }
  const fresh = makeInbox();
  try {
    window.localStorage.setItem(INBOX_KEY, fresh);
  } catch {
    // Nothing to do. The id lives in this page's memory for as long as it is open.
  }
  return fresh;
}

export default function HookPage() {
  const [inbox, setInbox] = useState<string | null>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [wired, setWired] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setInbox(loadInbox()), []);

  const poll = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/hook/${id}`, { cache: "no-store" });
      const body = await response.json();
      setWired(body.wired ?? false);
      setArrivals(body.arrivals ?? []);
    } catch {
      setWired(false);
    }
  }, []);

  useEffect(() => {
    if (inbox === null) return;
    void poll(inbox);
    const timer = setInterval(() => void poll(inbox), 4000);
    return () => clearInterval(timer);
  }, [inbox, poll]);

  const url = inbox === null ? "" : `${typeof window === "undefined" ? "" : window.location.origin}/api/hook/${inbox}`;

  return (
    <main>
      <header
        className="border-b px-6 pt-16 pb-10 md:px-12 lg:px-16"
        style={{ borderColor: "var(--rule)" }}
      >
        <h1 className="max-w-[24ch] text-4xl leading-[1.05] font-medium sm:text-6xl lg:text-7xl">
          Copy one URL. Paste it anywhere.
        </h1>
        <p
          className="mt-6 max-w-[60ch] text-lg leading-relaxed"
          style={{ color: "var(--paper-dim)" }}
        >
          Zapier, n8n, Make, or CALL-E itself. Anything that already sends webhooks can send them
          here. Nothing to install and no key to hand over.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section
          className="border-b px-6 py-10 md:px-12 lg:border-r lg:border-b-0 lg:px-16 lg:py-14"
          style={{ borderColor: "var(--rule)" }}
        >
          <p
            className="font-mono text-xs tracking-[0.18em] uppercase"
            style={{ color: "var(--paper-faint)" }}
          >
            your webhook url
          </p>

          <div
            className="mt-4 flex flex-wrap items-center gap-4 border p-4"
            style={{ borderColor: "var(--rule)", background: "#0e0e10" }}
          >
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap">
              {url || "..."}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 border px-4 py-2 font-mono text-xs tracking-[0.16em] uppercase"
              style={{ borderColor: "var(--paper)" }}
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>

          {wired === false ? (
            <p
              className="mt-6 max-w-[62ch] border-l-2 pl-4 text-[15px] leading-relaxed"
              style={{ borderColor: "var(--alarm)", color: "var(--paper-dim)" }}
            >
              This deployment has no store behind it yet, so anything posted to that URL has
              nowhere to land. The endpoint answers, it just cannot keep anything.
            </p>
          ) : null}

          <div className="mt-12">
            <p
              className="font-mono text-xs tracking-[0.18em] uppercase"
              style={{ color: "var(--paper-faint)" }}
            >
              {arrivals.length === 0 ? "waiting" : `${arrivals.length} arrived`}
            </p>

            {arrivals.length === 0 ? (
              <p className="mt-4 max-w-[54ch] text-[15px]" style={{ color: "var(--paper-dim)" }}>
                Nothing yet. This page checks every few seconds. Events stay for a day and then go
                on their own.
              </p>
            ) : (
              <ul className="mt-6 flex flex-col">
                {arrivals.map((arrival, index) => (
                  <li
                    key={`${arrival.at}-${index}`}
                    className="border-t py-6 last:border-b"
                    style={{ borderColor: "var(--rule)" }}
                  >
                    <p className="font-mono text-xs" style={{ color: "var(--paper-faint)" }}>
                      {new Date(arrival.at).toLocaleTimeString()}
                    </p>

                    {arrival.reading ? (
                      <>
                        <p className="mt-2 text-[17px] leading-snug">
                          {arrival.reading.spoken.headline}
                        </p>
                        <p
                          className="mt-2 flex flex-wrap gap-x-4 font-mono text-[10px] tracking-[0.14em] uppercase"
                          style={{ color: "var(--paper-faint)" }}
                        >
                          {(["endstate", "taskOutcome", "resultState"] as const).map((axis) => (
                            <span
                              key={axis}
                              style={{
                                color: basisColor(arrival.reading!.disposition[axis].basis),
                              }}
                            >
                              {arrival.reading!.disposition[axis].value}
                            </span>
                          ))}
                        </p>
                        <p
                          className="mt-3 max-w-[68ch] border-l-2 pl-4 text-[15px] leading-relaxed"
                          style={{ borderColor: "var(--alarm)", color: "var(--paper-dim)" }}
                        >
                          {arrival.reading.disposition.reasons[0]}
                        </p>
                      </>
                    ) : (
                      <p
                        className="mt-2 max-w-[68ch] border-l-2 pl-4 text-[15px] leading-relaxed"
                        style={{ borderColor: "var(--absent)", color: "var(--paper-dim)" }}
                      >
                        Arrived, and could not be read. {arrival.unreadable} It is kept anyway,
                        because an event nobody can read is still an event that happened.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="px-6 py-10 md:px-12 lg:px-10 lg:py-14">
          <div className="lg:sticky lg:top-8">
            <p
              className="font-mono text-xs tracking-[0.2em] uppercase"
              style={{ color: "var(--alarm)" }}
            >
              everything here is unverified
            </p>
            <div
              className="mt-5 flex flex-col gap-4 text-[15px] leading-relaxed"
              style={{ color: "var(--paper-dim)" }}
            >
              <p>
                CALL-E webhooks carry no signature and no shared secret. Their issue #91 is open on
                exactly that, and it is not something a receiver can work around.
              </p>
              <p>
                So anybody who learns this URL can post to it, and what they post looks identical to
                the real thing. Every event here is marked as a claim about a call rather than a
                reading of one, and every one of them wants a person, even the ones where all three
                readings are stated facts and they agree.
              </p>
              <p>
                Treat the URL as a secret. It is the only thing between this inbox and the whole
                internet.
              </p>
              <p style={{ color: "var(--paper-faint)" }}>
                Events are kept for a day, fifty at a time, then they expire on their own.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
