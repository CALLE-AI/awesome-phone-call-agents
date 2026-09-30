"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pollCoverage } from "@/app/actions";
import { CoverageReelPlayer } from "@/components/reel-player";
import type { CoverageCard, CoverageSnapshot, LiveCall } from "@/lib/queries";
import { WAVE_RING_MS, callDurationMs, phaseForAttempt } from "@/lib/wave-timing";

const COLUMNS = [
  { key: "critical", label: "Critical", count: "text-critical" },
  { key: "follow_up", label: "Follow-up", count: "text-follow" },
  { key: "safe", label: "Safe", count: "text-safe" },
  { key: "unaccounted", label: "Unaccounted", count: "text-unaccounted" },
] as const;

const STEPS = ["Queued", "Calling", "Talking"] as const;
const FLY_MS = 520;

type Flight = {
  attemptId: string;
  card: CoverageCard;
  from: DOMRect;
  to: DOMRect;
};

export function CoverageBoard({ eventId, initial }: { eventId: string; initial: CoverageSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [arrived, setArrived] = useState<Set<string>>(() => new Set(initial.cards.map((card) => card.attemptId)));
  const rowEls = useRef(new Map<string, HTMLElement>());
  const rowRects = useRef(new Map<string, DOMRect>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const prevLive = useRef(initial.live.map((call) => call.attemptId));
  const live = snapshot.waveStatus === "running" || snapshot.live.length > 0;

  useEffect(() => {
    setSnapshot(initial);
    prevLive.current = initial.live.map((call) => call.attemptId);
    setArrived(new Set(initial.cards.map((card) => card.attemptId)));
  }, [initial]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const tick = async () => {
      const next = await pollCoverage(eventId);
      if (!cancelled) setSnapshot(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [eventId, live]);

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
    const nextIds = new Set(snapshot.live.map((call) => call.attemptId));
    const landed = prevLive.current.filter((id) => !nextIds.has(id));
    prevLive.current = snapshot.live.map((call) => call.attemptId);
    if (landed.length === 0) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setArrived((current) => {
        const next = new Set(current);
        for (const id of landed) next.add(id);
        return next;
      });
      return;
    }

    const nextFlights: Flight[] = [];
    for (const attemptId of landed) {
      const card = snapshot.cards.find((item) => item.attemptId === attemptId);
      const from = rowRects.current.get(attemptId);
      const dest = cardEls.current.get(attemptId);
      if (!card || !from || !dest) {
        setArrived((current) => new Set(current).add(attemptId));
        continue;
      }
      nextFlights.push({ attemptId, card, from, to: dest.getBoundingClientRect() });
    }
    if (nextFlights.length > 0) setFlights((current) => [...current, ...nextFlights]);
  }, [snapshot]);

  const { coverage, cards } = snapshot;
  const max = Math.max(coverage.planned, coverage.dialed, 1);
  const unaccounted = cards.filter((card) => card.severity === "unaccounted");
  const idle = snapshot.waveStatus === "idle";
  return (
    <>
      <section className="overflow-hidden rounded-2xl bg-white shadow-card">
        <div className="grid grid-cols-3 divide-x divide-line">
          <Metric
            label="Dialed"
            value={coverage.dialed}
            hint={
              coverage.inFlight > 0
                ? `${coverage.inFlight} on the line`
                : coverage.queued > 0
                  ? `${coverage.queued} queued`
                  : undefined
            }
          />
          <Metric label="Reached" value={coverage.reached} tone="text-safe" />
          <Metric label="Unreached" value={coverage.unreached} tone="text-unaccounted" hint="Voicemail sits here" />
        </div>
        <div className="px-5 pb-4">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-canvas">
            <div className="bg-safe" style={{ width: `${(coverage.reached / max) * 100}%` }} />
            <div className="bg-unaccounted" style={{ width: `${(coverage.unreached / max) * 100}%` }} />
            <div className="bg-ink/20" style={{ width: `${(coverage.inFlight / max) * 100}%` }} />
          </div>
        </div>
      </section>

      {idle ? (
        <section className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 shadow-card">
          <div>
            <p className="text-sm font-medium">No wave yet</p>
            <p className="mt-0.5 text-sm text-mute">Confirm wave 1 to start the drill.</p>
          </div>
          <Link href={`/events/${eventId}/waves/new`} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">
            New wave
          </Link>
        </section>
      ) : null}

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
                key={call.attemptId}
                ref={(el) => {
                  if (el) {
                    rowEls.current.set(call.attemptId, el);
                    rowRects.current.set(call.attemptId, el.getBoundingClientRect());
                  } else {
                    rowEls.current.delete(call.attemptId);
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
          const important = column.key === "unaccounted";
          return (
            <div
              key={column.key}
              className={`rounded-2xl bg-white shadow-card ${important ? "ring-1 ring-unaccounted/30" : ""}`}
            >
              <div className="flex items-baseline justify-between px-4 py-3">
                <h2 className="text-sm font-medium">{column.label}</h2>
                <span className={`tabular text-xl font-semibold ${column.count}`}>{items.length}</span>
              </div>
              <ul className="space-y-1.5 px-3 pb-3">
                {items.map((card) => {
                  const hidden = !arrived.has(card.attemptId);
                  return (
                    <li
                      key={card.id}
                      ref={(el) => {
                        if (el) cardEls.current.set(card.attemptId, el);
                        else cardEls.current.delete(card.attemptId);
                      }}
                      className={hidden ? "invisible" : undefined}
                    >
                      <TriageLink card={card} />
                    </li>
                  );
                })}
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

      {snapshot.waveStatus !== "idle" ? (
        <details open className="rounded-2xl bg-white px-5 py-2 shadow-card">
          <summary className="cursor-pointer text-sm text-mute">Coverage reel</summary>
          <div className="py-3">
            <CoverageReelPlayer
              dialed={coverage.dialed}
              reached={coverage.reached}
              unaccounted={coverage.unreached}
              names={unaccounted.map((card) => card.household?.displayName ?? card.rosterEntryId)}
            />
          </div>
        </details>
      ) : null}
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
    const from = `${Math.min(100, (elapsed / duration) * 100)}%`;
    const remaining = delayMs > 0 ? duration : Math.max(0, duration - elapsed);
    return { start, delayMs, from, remaining };
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
    arm(start + WAVE_RING_MS, "on_the_line");
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
          const doneAt = timing.start + (index === 0 ? 0 : index === 1 ? WAVE_RING_MS : callDurationMs());
          const already = Date.now() >= doneAt && index < 2;
          const wait = Math.max(0, doneAt - Date.now());
          return (
            <span
              key={step}
              className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                already ? "bg-safe" : "bg-white ring-1 ring-line"
              } ${index < 2 && !already ? "step-dot-fill" : ""}`}
              style={{
                left: `${(index / (STEPS.length - 1)) * 100}%`,
                animationDelay: `${wait}ms`,
              }}
            />
          );
        })}
        <span className="phase-pin absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" style={travel}>
          <span className="live-ripple live-ripple-delay absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-live" />
          <span className="live-ripple absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-live" />
          <span className="relative block size-3 rounded-full bg-live ring-[3px] ring-white shadow-[0_0_0_1px_rgba(26,115,232,0.35)]" />
        </span>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-mute">
        {STEPS.map((step, index) => (
          <span
            key={step}
            className={
              active === index ? "font-medium text-live" : index < active ? "font-medium text-safe" : undefined
            }
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
  const { from, to, card } = flight;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

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
      <p className="text-sm font-medium">{card.household?.displayName ?? card.rosterEntryId}</p>
      <p className="text-xs text-mute">{card.household?.phoneMasked}</p>
    </div>
  );
}

function TriageLink({ card }: { card: CoverageCard }) {
  return (
    <Link href={`/calls/${card.attemptId}`} className="block rounded-xl bg-canvas px-3 py-2 hover:bg-line">
      <p className="text-sm font-medium">{card.household?.displayName ?? card.rosterEntryId}</p>
      <p className="text-xs text-mute">{card.household?.phoneMasked}</p>
      {card.needs.length > 0 ? (
        <p className="mt-0.5 text-xs text-mute">{card.needs.map((need) => need.replaceAll("_", " ")).join(", ")}</p>
      ) : null}
    </Link>
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