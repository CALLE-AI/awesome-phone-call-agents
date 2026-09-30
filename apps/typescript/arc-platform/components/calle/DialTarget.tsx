"use client";

import { useEffect, useState } from "react";
import { PhoneOutgoing, TriangleAlert } from "lucide-react";

/**
 * Says which number a call will dial, before it dials.
 *
 * Four consecutive calls went to a number nobody expected, and finding that
 * out took CALL-E's dashboard. `resolvePhone` was right the whole time - a
 * typed number beats the env fallback - but the card only ever said "the
 * server's demo number", so the resolution was invisible at the one moment it
 * mattered. This makes it visible.
 *
 * Re-resolves as the user types, debounced, and reports the source so a blank
 * field and a typed number are told apart.
 */
export function DialTarget({ typed }: { typed: string }) {
  const [state, setState] = useState<{
    resolved: string | null;
    source: "typed" | "demo-env" | "none";
    valid: boolean;
    live: boolean;
    fallbackActive: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/calle/dial-target?phone=${encodeURIComponent(typed)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setState(data);
      } catch {
        /* Informational only - failing to resolve the indicator must never
           block the call itself. */
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [typed]);

  if (!state) return null;

  if (!state.resolved) {
    return (
      <p className="flex items-start gap-2 text-small text-warning">
        <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-3.5 shrink-0" />
        {state.fallbackActive
          ? "No number to dial — type one above, or set CALLE_DEMO_PHONE."
          : "Enter the number to call, in international format — Arc will ring it so you can hear the agent."}
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-small text-text-muted">
      <PhoneOutgoing aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
      Will dial <span className="type-data text-text">{state.resolved}</span>
      <span>· {state.source === "typed" ? "the number you typed" : "from CALLE_DEMO_PHONE"}</span>
      {!state.valid && <span className="text-danger">· not a valid E.164 number</span>}
      {!state.live && <span>· simulated, nothing is dialled</span>}
    </p>
  );
}
