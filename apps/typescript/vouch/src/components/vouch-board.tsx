"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pollBoard } from "@/app/actions";
import { ScopeReelPlayer, VerificationReelPlayer } from "@/components/reel-player";
import type { LiveCall, VouchCard, VouchSnapshot } from "@/lib/queries";
import { VOUCH_RING_MS, callDurationMs, phaseForAttempt } from "@/lib/vouch-timing";

const COLUMNS = [
  { key: "confirmed", label: "Confirmed", count: "text-safe" },
  { key: "third_party", label: "Third-party", count: "text-follow" },
  { key: "pending", label: "Pending", count: "text-mute" },
  { key: "blocked", label: "Blocked", count: "text-critical" },
] as const;

const STEPS = ["Queued", "Calling", "Talking"] as const;
const FLY_MS = 520;

type Flight = {
  attemptId: string;
  card: VouchCard;
  from: DOMRect;
  to: DOMRect;
};

export function VouchBoard({ initial }: { initial: VouchSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [arrived, setArrived] = useState<Set<string>>(() => new Set(initial.cards.map((card) => card.consentId)));
  const rowEls = useRef(new Map<string, HTMLElement>());
  const rowRects = useRef(new Map<string, DOMRect>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const prevLive = useRef(initial.live.map((call) => call.runId));
  const live = snapshot.live.length > 0;

  useEffect(() => {
    setSnapshot(initial);
    prevLive.current = initial.live.map((call) => call.runId);
    setArrived(new Set(initial.cards.map((card) => card.consentId)));
  }, [initial]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const tick = async () => {
      const next = await pollBoard();
      if (!cancelled) setSnapshot(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [live]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      for (const [attemptId, el] of rowEls.current) {
        rowRects.current.set(attemptId, el.getBoundingClientRect());
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [live]);

  useLayoutEffect(() => {
    const nextIds = new Set(snapshot.live.map((call) => call.runId));
    const landed = prevLive.current.filter((id) => !nextIds.has(id));
    prevLive.current = snapshot.live.map((call) => call.runId);
    if (landed.length === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setArrived((current) => {
        const next = new Set(current);
        for (const id of landed) {
          const card = snapshot.cards.find((item) => item.runId === id);
          if (card) next.add(card.consentId);
        }
        return next;
      });
      return;
    }
    const nextFlights: Flight[] = [];
    for (const runId of landed) {
      const card = snapshot.cards.find((item) => item.runId === runId);
      const from = rowRects.current.get(runId);
      const dest = card ? cardEls.current.get(card.consentId) : undefined;
      if (!card || !from || !dest) {
        if (card) setArrived((current) => new Set(current).add(card.consentId));
        continue;
      }
      nextFlights.push({ attemptId: card.consentId, card, from, to: dest.getBoundingClientRect() });
    }
    if (nextFlights.length > 0) setFlights((current) => [...current, ...nextFlights]);
  }, [snapshot]);

  const { coverage, cards } = snapshot;
  const max = Math.max(coverage.dialed, coverage.blocked, 1);
  const blockedNames = cards
    .filter((card) => card.severity === "blocked" || card.severity === "third_party")
    .map((card) => card.candidateName);

  return (
    <>
      <section className="overflow-hidden rounded-2xl bg-white shadow-card">
        <div className="grid grid-cols-3 divide-x divide-line">
          <Metric
            label="Dialed"
            value={coverage.dialed}
            hint={coverage.inFlight > 0 ? `${coverage.inFlight} on the line` : undefined}
          />
          <Metric label="Confirmed" value={coverage.confirmed} tone="text-safe" />
          <Metric label="Blocked" value={coverage.blocked} tone="text-critical" hint="No consent, or third-party only" />
        </div>
        <div className="px-5 pb-4">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className="bg-safe" style={{ width: `${(coverage.confirmed / max) * 100}%` }} />
            <div className="bg-critical" style={{ width: `${(coverage.blocked / max) * 100}%` }} />
            <div className="bg-ink/20" style={{ width: `${(coverage.inFlight / max) * 100}%` }} />
          </div>
        </div>
      </section>

      {snapshot.live.length > 0 ? (
        <section className="overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="flex items-baseline justify-between px-5 py-3">
            <h2 className="text-sm font-medium">In progress</h2>
            <p className="text-xs text-mute">
              {coverage.inFlight} live
              {coverage.queued > 0 ? ` · ${coverage.queued} queued` : ""}
            </p>
          </div>
          <ul>
            {snapshot.live.map((call) => (
              <li
                key={call.runId}
                ref={(el) => {
                  if (el) {
                    rowEls.current.set(call.runId, el);
                    rowRects.current.set(call.runId, el.getBoundingClientRect());
                  } else {
                    rowEls.current.delete(call.runId);
                  }
                }}
                className="flex items-center gap-4 border-t border-line px-5 py-2.5"
              >
                <div className="w-36 shrink-0">
                  <p className="text-sm font-medium">{call.displayName}</p>
                  <p className="text-xs text-mute">{call.phoneMasked}</p>
                </div>
                <PhaseTrack call={call} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const items = cards.filter((card) => card.severity === column.key);
          const important = column.key === "blocked";
          return (
            <div
              key={column.key}
              className={`rounded-2xl bg-white shadow-card ${important ? "ring-1 ring-critical/30" : ""}`}
            >
              <div className="flex items-baseline justify-between px-4 py-3">
                <h2 className="text-sm font-medium">{column.label}</h2>
                <span className={`tabular text-xl font-semibold ${column.count}`}>{items.length}</span>
              </div>
              <ul className="space-y-1.5 px-3 pb-3">
                {items.map((card) => (
                  <li
                    key={card.consentId}
                    ref={(el) => {
                      if (el) cardEls.current.set(card.consentId, el);
                      else cardEls.current.delete(card.consentId);
                    }}
                    className={!arrived.has(card.consentId) ? "invisible" : undefined}
                  >
                    <Link
                      href={card.runId ? `/runs/${card.runId}` : `/consents/${card.consentId}`}
                      className="block rounded-xl bg-canvas px-3 py-2 hover:bg-line"
                    >
                      <p className="text-sm font-medium">{card.candidateName}</p>
                      <p className="text-xs text-mute">{card.phoneMasked}</p>
                      <p className="mt-0.5 text-xs text-mute">{card.hint}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {flights.map((flight) => (
        <FlightCard
          key={flight.attemptId}
          flight={flight}
          onDone={() => {
            setFlights((current) => current.filter((item) => item.attemptId !== flight.attemptId));
            setArrived((current) => new Set(current).add(flight.attemptId));
          }}
        />
      ))}

      <details open className="rounded-2xl bg-white px-5 py-2 shadow-card">
        <summary className="cursor-pointer text-sm text-mute">Verification reel</summary>
        <div className="py-3">
          <VerificationReelPlayer
            dialed={coverage.dialed}
            confirmed={coverage.confirmed}
            blocked={coverage.blocked}
            names={blockedNames}
          />
        </div>
      </details>

      <details open className="rounded-2xl bg-white px-5 py-2 shadow-card">
        <summary className="cursor-pointer text-sm text-mute">Scope reel</summary>
        <div className="py-3">
          <ScopeReelPlayer {...snapshot.scope} />
        </div>
      </details>
    </>
  );
}

function PhaseTrack({ call }: { call: LiveCall }) {
  const timing = useMemo(() => {
    const start = call.startedAt ?? Date.now();
    const now = Date.now();
    const duration = callDurationMs();
    const delayMs = Math.max(0, start - now);
    const elapsed = Math.max(0, now - start);
    return {
      start,
      delayMs,
      from: `${Math.min(100, (elapsed / duration) * 100)}%`,
      remaining: delayMs > 0 ? duration : Math.max(0, duration - elapsed),
    };
  }, [call.startedAt]);
  const [phase, setPhase] = useState(() => phaseForAttempt(call.startedAt));

  useEffect(() => {
    const start = call.startedAt ?? Date.now();
    const timers: number[] = [];
    const arm = (at: number, next: typeof phase) => {
      const wait = at - Date.now();
      if (wait <= 0) setPhase(next);
      else timers.push(window.setTimeout(() => setPhase(next), wait));
    };
    arm(start, "ringing");
    arm(start + VOUCH_RING_MS, "on_the_line");
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [call.startedAt]);

  const active = phase === "queued" ? 0 : phase === "ringing" ? 1 : 2;
  const travel = {
    ["--phase-from" as string]: timing.from,
    animationDuration: `${timing.remaining}ms`,
    animationDelay: `${timing.delayMs}ms`,
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="relative h-5">
        <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-line" />
        <div className="phase-fill absolute left-1 top-1/2 h-0.5 -translate-y-1/2 bg-live/50" style={travel} />
        {STEPS.map((step, index) => {
          const doneAt = timing.start + (index === 0 ? 0 : index === 1 ? VOUCH_RING_MS : callDurationMs());
          const already = Date.now() >= doneAt && index < 2;
          return (
            <span
              key={step}
              className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                already ? "bg-safe" : "bg-white ring-1 ring-line"
              } ${index < 2 && !already ? "step-dot-fill" : ""}`}
              style={{
                left: `${(index / (STEPS.length - 1)) * 100}%`,
                animationDelay: `${Math.max(0, doneAt - Date.now())}ms`,
              }}
            />
          );
        })}
        <span className="phase-pin absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={travel}>
          <span className="live-ripple live-ripple-delay absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-live" />
          <span className="live-ripple absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-live" />
          <span className="relative block size-3 rounded-full bg-live ring-[3px] ring-white" />
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-mute">
        {STEPS.map((step, index) => (
          <span
            key={step}
            className={active === index ? "font-medium text-live" : index < active ? "font-medium text-safe" : undefined}
          >
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

function FlightCard({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const [delta, setDelta] = useState({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const { from, to, card } = flight;

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      setDelta({
        x: to.left - from.left,
        y: to.top - from.top,
        scaleX: to.width / Math.max(from.width, 1),
        scaleY: to.height / Math.max(from.height, 1),
      });
    });
    const done = window.setTimeout(() => doneRef.current(), FLY_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(done);
    };
  }, [from, to]);

  return (
    <div
      className="pointer-events-none fixed z-30 origin-top-left rounded-xl bg-canvas px-3 py-2 shadow-card"
      style={{
        left: from.left,
        top: from.top,
        width: from.width,
        height: from.height,
        transform: `translate(${delta.x}px, ${delta.y}px) scale(${delta.scaleX}, ${delta.scaleY})`,
        transition: `transform ${FLY_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
    >
      <p className="text-sm font-medium">{card.candidateName}</p>
      <p className="text-xs text-mute">{card.phoneMasked}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "text-ink",
  hint,
}: {
  label: string;
  value: number;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs text-mute">{label}</p>
      <p className={`mt-1 tabular text-4xl font-semibold leading-none ${tone}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-mute">{hint}</p> : null}
    </div>
  );
}