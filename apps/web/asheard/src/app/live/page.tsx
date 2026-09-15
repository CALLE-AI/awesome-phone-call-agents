"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DESTINATIONS } from "asheard/reconciler";

/**
 * The same number, dialled twice, with one question added.
 *
 * Both calls do the same thing. Both come back `completed` with
 * `task_completed: true` and a confident score. The only difference is that the
 * second request also asks CALL-E to classify who picked up, which their calls
 * guide says you have to do yourself because the API carries no answered-by
 * field of its own.
 *
 * Watch what that changes. Without the question the honest reading is that
 * nothing establishes a person was ever on the line. With it, the payload says
 * a recording answered, in the same object that says the job is done.
 *
 * Nobody has to know what a payload is to see the point.
 */

interface Reading {
  platform: Record<string, unknown>;
  evidence: {
    read: Record<"endstate" | "taskOutcome" | "resultState", Axis>;
    observed: { status: { value: string } | null };
    flags: { code: string; summary: string; from: string[] }[];
  };
  band: string;
  because: { summary: string; from: string[] };
  spoken: {
    line: string;
    clauses: { ending: string; outcome: string; doubt: string | null; action: string | null };
  };
}

interface Axis {
  value: string;
  basis: string;
  from: string[];
  note: string;
}

interface Lane {
  asked: boolean;
  callId: string;
  readToken: string;
  requestedAt: string;
  reading: Reading | null;
  done: boolean;
  problem: string;
}

type Phase = "idle" | "placing" | "running" | "done";

const BASIS_COLOR: Record<string, string> = {
  quoted: "text-emerald-700",
  derived: "text-amber-700",
  absent: "text-neutral-500",
};

const TERMINAL = ["completed", "failed", "canceled"];

function emptyLane(asked: boolean): Lane {
  return { asked, callId: "", readToken: "", requestedAt: "", reading: null, done: false, problem: "" };
}

/**
 * Place one lane, and retry once if the answer never arrives.
 *
 * The retry is safe only because the intent key does not move: the server
 * either hands back the call the first attempt created, or refuses to dial
 * because that attempt may already be in flight. Before the key was stable this
 * retry would have been a second phone call, which is why it did not exist.
 */
async function postLane(
  intentKey: string,
  destinationId: string,
  asked: boolean,
  operatorToken: string,
): Promise<Lane> {
  const lane = emptyLane(asked);
  const body = JSON.stringify({ destinationId, askWhoAnswered: asked, intentKey });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json", "x-asheard-operator": operatorToken },
        body,
      });
    } catch {
      // Never reached the server, or the answer was lost on the way back. Only
      // the second of those could have placed a call, and the key covers it.
      if (attempt === 0) continue;
      lane.problem = "The demo could not be reached.";
      lane.done = true;
      return lane;
    }

    const parsed = (await response.json()) as {
      callId?: string;
      readToken?: string;
      requestedAt?: string;
      error?: string;
    };

    if (!response.ok || !parsed.callId) {
      lane.problem = parsed.error ?? "The call could not be placed.";
      lane.done = true;
      return lane;
    }

    lane.callId = parsed.callId;
    lane.readToken = parsed.readToken ?? "";
    lane.requestedAt = parsed.requestedAt ?? "";
    return lane;
  }

  lane.problem = "The call could not be placed.";
  lane.done = true;
  return lane;
}

export default function LivePage() {
  const [chosen, setChosen] = useState(DESTINATIONS[0]!.id);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lanes, setLanes] = useState<Lane[]>([emptyLane(false), emptyLane(true)]);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState("");
  // Minted by the operator for the chosen number. Held in memory, never stored.
  const [operatorToken, setOperatorToken] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const destination = DESTINATIONS.find((d) => d.id === chosen)!;
  const busy = phase === "placing" || phase === "running";

  const place = useCallback(async () => {
    setPhase("placing");
    setNotice("");
    setElapsed(0);
    setLanes([emptyLane(false), emptyLane(true)]);

    /**
     * One press, one name for it.
     *
     * Minted here rather than on the server because pressing the button is the
     * authorization, and the server has no other way to tell a retry of this
     * press from somebody deciding to call again. It is stable for the whole
     * press, so `postLane` below can retry without risking a second call.
     */
    const intentKey = crypto.randomUUID();

    const started = await Promise.all(
      [false, true].map((asked) => postLane(intentKey, chosen, asked, operatorToken.trim())),
    );

    setLanes(started);
    if (started.every((l) => l.done)) {
      setPhase("done");
      setNotice("Neither call went out. Nothing was dialled.");
      return;
    }
    setPhase("running");
  }, [chosen, operatorToken]);

  useEffect(() => {
    if (phase !== "running") return;

    const tick = async () => {
      setElapsed((e) => e + 1);
      const next = await Promise.all(
        lanes.map(async (lane) => {
          if (lane.done || lane.callId === "") return lane;
          const query = new URLSearchParams({
            callId: lane.callId,
            token: lane.readToken,
            requestedAt: lane.requestedAt,
          });
          const response = await fetch(`/api/live?${query.toString()}`, { cache: "no-store" });
          if (!response.ok) return lane;
          const reading = (await response.json()) as Reading;
          const status = reading.evidence.observed.status?.value ?? "";
          return { ...lane, reading, done: TERMINAL.includes(status) };
        }),
      );
      setLanes(next);
      if (next.every((l) => l.done)) setPhase("done");
    };

    timer.current = setInterval(tick, 4000);
    void tick();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // lanes is read inside tick but re-subscribing on every poll would reset the
    // interval, so the effect deliberately keys only on the phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const both = lanes.every((l) => l.reading !== null);
  const showLanes = phase !== "idle";

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="max-w-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Live</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight text-neutral-900">
          The same number, called twice, one question apart.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-neutral-600">
          Both calls come back finished, with the job marked done and a confident score on it. The
          second request adds one thing: it asks CALL-E who picked up. Their own guide says you have
          to ask, because the API has no field for it. Watch what that one question changes.
        </p>
      </header>

      <section className="mt-10">
        <div className="grid gap-3 md:grid-cols-3">
          {DESTINATIONS.map((d) => {
            const active = d.id === chosen;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setChosen(d.id)}
                disabled={busy}
                className={`border-l-2 p-4 text-left transition ${
                  active ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 hover:border-neutral-400"
                } disabled:opacity-50`}
              >
                <span className="block text-sm font-medium text-neutral-900">{d.label}</span>
                <span className="mt-1 block font-mono text-xs text-neutral-500">{d.e164}</span>
                <span className="mt-2 block text-xs leading-relaxed text-neutral-600">
                  {d.expectation}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-neutral-500">{destination.why}</p>

        <label className="mt-6 block max-w-md">
          <span className="text-xs text-neutral-500">Operator token for this number</span>
          <input
            type="password"
            value={operatorToken}
            onChange={(e) => setOperatorToken(e.target.value)}
            autoComplete="off"
            disabled={busy}
            className="mt-1 w-full border border-neutral-300 p-2 font-mono text-xs"
          />
          <span className="mt-1 block text-xs leading-relaxed text-neutral-400">
            npm run operator-token -- dial &lt;number&gt;. A token only dials the number it was made for.
          </span>
        </label>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={place}
            disabled={busy || operatorToken.trim() === ""}
            className="bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === "placing"
              ? "Placing both calls"
              : phase === "running"
                ? "Both calls running"
                : "Place both calls"}
          </button>
          {phase === "running" ? (
            <span className="text-sm text-neutral-500">Ringing. {elapsed * 4} seconds in.</span>
          ) : null}
          <span className="text-xs text-neutral-400">
            Two calls, both to the number picked above.
          </span>
        </div>

        {notice !== "" ? (
          <p className="mt-4 max-w-2xl border-l-2 border-red-500 bg-red-50 p-4 text-sm text-red-900">
            {notice}
          </p>
        ) : null}
      </section>

      {showLanes ? (
        <section className="mt-12 grid gap-px border border-neutral-200 bg-neutral-200 lg:grid-cols-2">
          {lanes.map((lane) => (
            <LaneView key={lane.asked ? "asked" : "notasked"} lane={lane} />
          ))}
        </section>
      ) : null}

      {phase === "done" && both ? <Punchline lanes={lanes} /> : null}
    </main>
  );
}

function LaneView({ lane }: { lane: Lane }) {
  const r = lane.reading;
  return (
    <div className="bg-white p-6">
      <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
        {lane.asked ? "Asked who picked up" : "Did not ask"}
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-neutral-400">
        {lane.asked
          ? "recipient_result_schema declares answered_by"
          : "no recipient_result_schema on the request"}
      </p>

      {lane.problem !== "" ? (
        <p className="mt-5 border-l-2 border-red-500 pl-4 text-sm text-red-900">{lane.problem}</p>
      ) : null}

      {r ? (
        <>
          <div className="mt-6 border-t border-neutral-100 pt-5">
            <p className="text-xs text-neutral-500">What CALL-E returns</p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <Cell label="status" value={str(r.platform["status"])} />
              <Cell label="task_completed" value={str(r.platform["task_completed"])} />
              <Cell label="confidence" value={confidence(r.platform)} />
              <Cell label="answered_by" value={answeredBy(r.platform)} />
            </dl>
          </div>

          <div className="mt-6 border-t border-neutral-100 pt-5">
            <p className="text-xs text-neutral-500">What actually happened</p>
            <p className="mt-3 text-xl font-medium leading-snug text-neutral-900">
              {r.spoken.line || r.because.summary}
            </p>
            {r.spoken.clauses.action ? (
              <p className="mt-2 text-sm font-medium text-neutral-900">{r.spoken.clauses.action}</p>
            ) : null}

            <div className="mt-5">
              <p className="text-xs text-neutral-500">How it ended</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm text-neutral-900">
                  {r.evidence.read.endstate.value}
                </span>
                <span className={`text-xs ${BASIS_COLOR[r.evidence.read.endstate.basis]}`}>
                  {r.evidence.read.endstate.basis}
                </span>
              </p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-neutral-400">
                {r.evidence.read.endstate.from.length > 0
                  ? `read from ${r.evidence.read.endstate.from.join(", ")}`
                  : "no field carries this"}
              </p>
            </div>
          </div>
        </>
      ) : lane.problem === "" ? (
        <p className="mt-6 text-sm text-neutral-400">
          Nothing to say yet. This side stays empty rather than guessing.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The line at the bottom, computed rather than written.
 *
 * If both calls ever come back the same, this says so. A demo that can only
 * produce the answer it wanted is not evidence of anything.
 */
function Punchline({ lanes }: { lanes: Lane[] }) {
  const notAsked = lanes.find((l) => !l.asked)?.reading;
  const asked = lanes.find((l) => l.asked)?.reading;
  if (!notAsked || !asked) return null;

  const sameOnTheLeft =
    str(notAsked.platform["status"]) === str(asked.platform["status"]) &&
    str(notAsked.platform["task_completed"]) === str(asked.platform["task_completed"]);

  const left = notAsked.evidence.read.endstate;
  const right = asked.evidence.read.endstate;

  return (
    <section className="mt-10 border-l-2 border-neutral-900 bg-neutral-50 p-6">
      <p className="max-w-3xl text-lg leading-relaxed text-neutral-900">
        {sameOnTheLeft
          ? `Both calls came back ${str(notAsked.platform["status"])} with the job marked ${str(notAsked.platform["task_completed"])}. `
          : "The two calls did not come back the same on the platform's own fields, so read them side by side rather than as a pair. "}
        {left.basis === "absent" && right.basis === "quoted"
          ? `Only the one that asked can say who picked up. Without the question the ending is "${left.value}" and nothing carries it. With it, the ending is "${right.value}", read straight off a field.`
          : `The endings read "${left.value}" and "${right.value}".`}
      </p>
      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-neutral-600">
        That is the whole difference. One field on the request, and a call that looked finished
        becomes a call you can see the shape of. The field costs nothing and almost nobody sends it,
        because the field everyone actually branches on is task_completed.
      </p>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[11px] text-neutral-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-neutral-900">{value}</dd>
    </div>
  );
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "not set";
  return String(v);
}

function confidence(payload: Record<string, unknown>): string {
  const c = payload["completion_confidence"];
  if (c && typeof c === "object") {
    const o = c as { score?: unknown; label?: unknown };
    return `${String(o.score ?? "")} ${String(o.label ?? "")}`.trim();
  }
  return "not set";
}

/** Read the declared classification back, wherever the app put it. */
function answeredBy(payload: Record<string, unknown>): string {
  const recipients = payload["recipients"];
  if (Array.isArray(recipients)) {
    for (const r of recipients) {
      const result = (r as { structured_result?: Record<string, unknown> | null })
        ?.structured_result;
      const v = result?.["answered_by"];
      if (typeof v === "string" && v !== "") return v;
    }
  }
  return "nothing carries it";
}
