"use client";

import Link from "next/link";
import { useState } from "react";
import type { Disposition, Spoken } from "asheard/disposition";

import voicemail from "../../fixtures/calls-api/completed-voicemail-task-completed.json";
import ranOut from "../../fixtures/calls-api/failed-with-synthesized-result.json";
import busy from "../../fixtures/calls-api/failed-busy-attempt-486.json";
import goalRun from "../../fixtures/goal-runs/result-ok.json";

import { Payload, Readings, Verdict } from "@/components/reading";
import { remember } from "@/lib/queue";

const SAMPLES: Array<{ name: string; blurb: string; payload: unknown }> = [
  {
    name: "the voicemail",
    blurb: "reported done, at 0.9 confidence, to an answering machine",
    payload: voicemail,
  },
  { name: "the one that rang out", blurb: "a result from a call nobody answered", payload: ranOut },
  { name: "the busy line", blurb: "0.46 seconds, and the message calls it no answer", payload: busy },
  { name: "a goal run", blurb: "a different surface, a different vocabulary", payload: goalRun },
];

interface Reading {
  disposition: Disposition;
  spoken: Spoken;
  payload: unknown;
  key: string;
}

export default function Page() {
  const [raw, setRaw] = useState("");
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [cited, setCited] = useState<readonly string[]>([]);

  async function read(text: string) {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const body = await response.json();
      if (!response.ok) {
        setReading(null);
        setError(body.error ?? "Something went wrong reading that.");
        return;
      }

      const payload: unknown = JSON.parse(text);
      const entry = remember({
        payload,
        disposition: body.disposition,
        spoken: body.spoken,
      });
      setReading({ ...body, payload, key: entry.key });
    } catch {
      setError("That is not JSON. Paste the whole response object, brackets and all.");
      setReading(null);
    } finally {
      setWorking(false);
    }
  }

  function loadSample(payload: unknown) {
    const text = JSON.stringify(payload, null, 2);
    setRaw(text);
    void read(text);
  }

  function again() {
    setReading(null);
    setRaw("");
    setError(null);
  }

  return (
    <main>
      {reading ? (
        <Verdict
          spoken={reading.spoken}
          aside={
            <Link
              href="/queue"
              className="font-mono text-xs underline underline-offset-4"
              style={{ color: "var(--paper-faint)" }}
            >
              it is in the queue
            </Link>
          }
        />
      ) : (
        <header
          className="border-b px-6 pt-16 pb-10 md:px-12 lg:px-16"
          style={{ borderColor: "var(--rule)" }}
        >
          <h1 className="max-w-[24ch] text-4xl leading-[1.05] font-medium sm:text-6xl lg:text-7xl">
            Three answers, not one status.
          </h1>
          <p
            className="mt-6 max-w-[58ch] text-lg leading-relaxed"
            style={{ color: "var(--paper-dim)" }}
          >
            Paste what CALL-E gave you. This says how the call ended, whether the job got done, and
            whether usable data came back, as three separate readings. Next to each one it names the
            field it came from, and whether anybody stated it or we worked it out.
          </p>
        </header>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section
          className="border-b px-6 py-10 md:px-12 lg:border-r lg:border-b-0 lg:px-16 lg:py-14"
          style={{ borderColor: "var(--rule)" }}
        >
          {reading ? (
            <Readings disposition={reading.disposition} onHover={setCited} />
          ) : (
            <Paste
              raw={raw}
              setRaw={setRaw}
              onRead={() => void read(raw)}
              working={working}
              error={error}
            />
          )}
        </section>

        <aside className="px-6 py-10 md:px-12 lg:px-10 lg:py-14">
          {reading ? (
            <Payload
              payload={reading.payload}
              cited={cited}
              action={
                <button
                  type="button"
                  onClick={again}
                  className="font-mono text-xs underline underline-offset-4"
                  style={{ color: "var(--paper-faint)" }}
                >
                  read another
                </button>
              }
            />
          ) : (
            <Samples onPick={loadSample} />
          )}
        </aside>
      </div>
    </main>
  );
}

function Paste({
  raw,
  setRaw,
  onRead,
  working,
  error,
}: {
  raw: string;
  setRaw: (value: string) => void;
  onRead: () => void;
  working: boolean;
  error: string | null;
}) {
  return (
    <div>
      <label
        htmlFor="payload"
        className="font-mono text-xs tracking-[0.18em] uppercase"
        style={{ color: "var(--paper-faint)" }}
      >
        paste a payload
      </label>
      <textarea
        id="payload"
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        spellCheck={false}
        placeholder={'{\n  "id": "call_...",\n  "status": "completed"\n}'}
        className="mt-4 block max-h-[46vh] min-h-[18rem] w-full resize-y border p-4 font-mono text-[13px] leading-[1.7] outline-none focus:border-[var(--derived)]"
        style={{ borderColor: "var(--rule)", background: "#0e0e10", color: "var(--paper)" }}
      />

      <div className="mt-6 flex flex-wrap items-center gap-5">
        <button
          type="button"
          onClick={onRead}
          disabled={working || raw.trim() === ""}
          className="border px-6 py-3 font-mono text-xs tracking-[0.18em] uppercase disabled:opacity-35"
          style={{ borderColor: "var(--paper)", color: "var(--paper)" }}
        >
          {working ? "reading" : "read it"}
        </button>
        <p className="text-sm" style={{ color: "var(--paper-faint)" }}>
          No key, no account. The queue stays in this browser.
        </p>
      </div>

      {error ? (
        <p
          className="mt-6 max-w-[62ch] border-l-2 pl-4 text-[15px] leading-relaxed"
          style={{ borderColor: "var(--alarm)", color: "var(--paper-dim)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Samples({ onPick }: { onPick: (payload: unknown) => void }) {
  return (
    <div className="lg:sticky lg:top-8">
      <p
        className="font-mono text-xs tracking-[0.2em] uppercase"
        style={{ color: "var(--paper-faint)" }}
      >
        or use a real one
      </p>
      <p className="mt-4 max-w-[42ch] text-sm leading-relaxed" style={{ color: "var(--paper-dim)" }}>
        These four came off real calls placed on 3 September 2026. Nothing has been edited.
      </p>
      <ul className="mt-7 flex flex-col">
        {SAMPLES.map((sample) => (
          <li
            key={sample.name}
            className="border-t last:border-b"
            style={{ borderColor: "var(--rule)" }}
          >
            <button
              type="button"
              onClick={() => onPick(sample.payload)}
              className="group w-full py-5 text-left"
            >
              <span className="font-mono text-sm group-hover:text-[var(--derived)]">
                {sample.name}
              </span>
              <span className="mt-1 block text-sm" style={{ color: "var(--paper-faint)" }}>
                {sample.blurb}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
