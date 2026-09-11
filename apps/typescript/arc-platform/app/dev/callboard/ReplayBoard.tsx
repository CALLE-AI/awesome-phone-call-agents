"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";

import { Button } from "@/components/ui/button";
import CallBoardCard from "@/app/_components/CallBoardCard";
import type { CallSnapshot } from "@/lib/call-board";
import replay from "./_replay.json";

/**
 * Plays a captured call back turn by turn, so every state the board can be in
 * is reachable without dialling anyone.
 *
 * No mandate is injected here. It used to be - a real mandate, target 7,000 -
 * and it made a call placed BEFORE the mandate existed show "Target 7,000 /
 * Walk-away 9,000" on its card. Those numbers were never given to that call. A
 * card shows what its own call carried, and these three carried none, so the
 * panel is absent on all of them.
 *
 * The fixtures are synthetic. They replaced captures of real calls, which do
 * not belong in a public repository: the person answering a cold call did not
 * agree to be quoted in one.
 */
const CALLS = replay as unknown as CallSnapshot[];

/** Fast enough to watch, slow enough to read. */
const TICK_MS = 450;

export default function ReplayBoard() {
  const [which, setWhich] = useState(0);
  const [turns, setTurns] = useState(0);
  const [playing, setPlaying] = useState(true);
  /* Stands in for "CALL-E did not answer our status read". Proves the waiting
     state without needing CALL-E to actually go quiet. */
  const [stalled, setStalled] = useState(false);
  /* A what-if, clearly labelled as one. These three calls predate the estimate
     being persisted, so their records genuinely hold none - and backfilling it
     from today's catalogue would be the same drift the persisted column exists
     to prevent. This asks "what would the card show if this line had been
     estimated at 8,000", which is how a live call will arrive. */
  const [assumeEstimate, setAssumeEstimate] = useState(false);

  const call = CALLS[which];
  const total = call.turns.length;
  const done = turns >= total;

  useEffect(() => {
    if (!playing || done || stalled) return;
    const t = setTimeout(() => setTurns((n) => n + 1), TICK_MS);
    return () => clearTimeout(t);
  }, [playing, done, stalled, turns]);

  /* Mid-replay the call is in progress; at the end it is whatever it really
     ended as. This is what makes the states real rather than mocked. */
  const snapshot: CallSnapshot = {
    ...call,
    status: done ? call.status : "in_progress",
    structuredResult: done ? call.structuredResult : null,
    unreachable: stalled,
    estimatePkr: assumeEstimate ? 8000 : call.estimatePkr ?? null,
  };

  function pick(i: number) {
    setWhich(i); setTurns(0); setPlaying(true); setStalled(false); setAssumeEstimate(false);
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-5 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-h1 text-text">Call board — replay</h1>
        <p className="text-body text-text-muted">
          Three written samples, played back from disk. No CALL-E, no phone.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {CALLS.map((c, i) => (
          <button
            key={c.id}
            onClick={() => pick(i)}
            className={`rounded-pill border px-3 py-1.5 text-small ${
              i === which ? "border-lilac-deep bg-lilac text-ink" : "border-border text-text-muted"
            }`}
          >
            {c.targetName} · {c.turns.length} turns · {c.status}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setPlaying((p) => !p)}>
          {playing ? <Pause aria-hidden strokeWidth={1.75} /> : <Play aria-hidden strokeWidth={1.75} />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setTurns(total)}>
          <SkipForward aria-hidden strokeWidth={1.75} />
          Skip to end
        </Button>
        <Button size="sm" variant="outline" onClick={() => pick(which)}>
          <RotateCcw aria-hidden strokeWidth={1.75} />
          Restart
        </Button>
        <Button
          size="sm"
          variant={stalled ? "secondary" : "ghost"}
          onClick={() => setStalled((s) => !s)}
        >
          {stalled ? "Resume status reads" : "Simulate CALL-E going quiet"}
        </Button>
        <Button
          size="sm"
          variant={assumeEstimate ? "secondary" : "ghost"}
          onClick={() => setAssumeEstimate((v) => !v)}
        >
          {assumeEstimate ? "Drop the assumed estimate" : "What if this line were estimated at 8,000"}
        </Button>
        <span className="type-data text-text-muted">{Math.min(turns, total)} / {total}</span>
      </div>

      <CallBoardCard snapshot={snapshot} visibleTurns={turns} />
    </div>
  );
}
