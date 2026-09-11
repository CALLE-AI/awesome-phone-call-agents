"use client";

import { useCallback, useEffect, useState } from "react";
import type { Disposition, Spoken } from "asheard/disposition";

import { basisColor } from "@/components/reading";

interface Arrival {
  at: string;
  eventId: string | null;
  callId: string | null;
  reading: { disposition: Disposition; spoken: Spoken } | null;
  problem: string | null;
}

const ADDRESS = /\/api\/hook\/([0-9a-f]{32}\.[0-9a-f]{64})\s*$/;

export default function HookPage() {
  const [address, setAddress] = useState("");
  const [readToken, setReadToken] = useState("");
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const segment = ADDRESS.exec(address.trim())?.[1] ?? null;
  const ready = segment !== null && /^[0-9a-f]{64}$/.test(readToken.trim());

  const poll = useCallback(async () => {
    if (!ready || segment === null) return;
    try {
      const response = await fetch(`/api/hook/${segment}`, {
        cache: "no-store",
        headers: { "x-asheard-operator": readToken.trim() },
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error ?? "That inbox could not be read.");
        setArrivals([]);
        return;
      }
      setStatus(body.wired ? null : "This deployment has no store behind it, so nothing can land.");
      setArrivals(body.arrivals ?? []);
    } catch {
      setStatus("Could not reach the inbox.");
    }
  }, [ready, segment, readToken]);

  useEffect(() => {
    if (!ready) return;
    // First read on the next tick, then every few seconds. Both run from a
    // timer callback rather than the effect body.
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ready, poll]);

  return (
    <main>
      <header
        className="border-b px-6 pt-16 pb-10 md:px-12 lg:px-16"
        style={{ borderColor: "var(--rule)" }}
      >
        <h1 className="max-w-[24ch] text-4xl leading-[1.05] font-medium sm:text-6xl lg:text-7xl">
          A webhook tells you which call. CALL-E tells you what happened.
        </h1>
        <p
          className="mt-6 max-w-[60ch] text-lg leading-relaxed"
          style={{ color: "var(--paper-dim)" }}
        >
          Deliveries are unsigned, so this inbox never believes one. It takes the call id, fetches
          that call from CALL-E with the server&apos;s own key, and keeps only what CALL-E says.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section
          className="border-b px-6 py-10 md:px-12 lg:border-r lg:border-b-0 lg:px-16 lg:py-14"
          style={{ borderColor: "var(--rule)" }}
        >
          <label className="block">
            <span
              className="font-mono text-xs tracking-[0.18em] uppercase"
              style={{ color: "var(--paper-faint)" }}
            >
              inbox address
            </span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="https://.../api/hook/<id>.<post token>"
              autoComplete="off"
              spellCheck={false}
              className="mt-3 w-full border bg-transparent p-3 font-mono text-[13px]"
              style={{ borderColor: "var(--rule)" }}
            />
          </label>
          <label className="mt-6 block">
            <span
              className="font-mono text-xs tracking-[0.18em] uppercase"
              style={{ color: "var(--paper-faint)" }}
            >
              read token
            </span>
            <input
              type="password"
              value={readToken}
              onChange={(e) => setReadToken(e.target.value)}
              autoComplete="off"
              className="mt-3 w-full border bg-transparent p-3 font-mono text-[13px]"
              style={{ borderColor: "var(--rule)" }}
            />
          </label>

          {status !== null ? (
            <p
              className="mt-6 max-w-[62ch] border-l-2 pl-4 text-[15px] leading-relaxed"
              style={{ borderColor: "var(--alarm)", color: "var(--paper-dim)" }}
            >
              {status}
            </p>
          ) : null}

          <div className="mt-12">
            <p
              className="font-mono text-xs tracking-[0.18em] uppercase"
              style={{ color: "var(--paper-faint)" }}
            >
              {!ready ? "waiting for an address and token" : arrivals.length === 0 ? "waiting" : `${arrivals.length} arrived`}
            </p>

            <ul className="mt-6 flex flex-col">
              {arrivals.map((arrival, index) => (
                <li
                  key={`${arrival.at}-${index}`}
                  className="border-t py-6 last:border-b"
                  style={{ borderColor: "var(--rule)" }}
                >
                  <p className="font-mono text-xs" style={{ color: "var(--paper-faint)" }}>
                    {new Date(arrival.at).toLocaleTimeString()}
                    {arrival.callId ? `  ${arrival.callId}` : ""}
                  </p>
                  {arrival.reading ? (
                    <>
                      <p className="mt-2 text-[17px] leading-snug">{arrival.reading.spoken.headline}</p>
                      <p
                        className="mt-2 flex flex-wrap gap-x-4 font-mono text-[10px] tracking-[0.14em] uppercase"
                        style={{ color: "var(--paper-faint)" }}
                      >
                        {(["endstate", "taskOutcome", "resultState"] as const).map((axis) => (
                          <span
                            key={axis}
                            style={{ color: basisColor(arrival.reading!.disposition[axis].basis) }}
                          >
                            {arrival.reading!.disposition[axis].value}
                          </span>
                        ))}
                      </p>
                    </>
                  ) : (
                    <p
                      className="mt-2 max-w-[68ch] border-l-2 pl-4 text-[15px] leading-relaxed"
                      style={{ borderColor: "var(--absent)", color: "var(--paper-dim)" }}
                    >
                      {arrival.problem}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="px-6 py-10 md:px-12 lg:px-10 lg:py-14">
          <div
            className="flex flex-col gap-4 text-[15px] leading-relaxed lg:sticky lg:top-8"
            style={{ color: "var(--paper-dim)" }}
          >
            <p>
              The operator mints the address and the read token with{" "}
              <code className="font-mono text-[13px]">npm run operator-token -- inbox</code>. The
              address goes to whatever sends the webhook. The read token stays with you. Holding the
              address is not enough to read anything back.
            </p>
            <p>
              Anybody with the address can still post to it. That is the part nobody can fix while
              deliveries are unsigned, so a delivery only ever decides which call gets looked up. A
              call id that is not on this account is refused, and a delivery with no call id is
              dropped.
            </p>
            <p style={{ color: "var(--paper-faint)" }}>
              Fifty arrivals per inbox, kept for a day.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
