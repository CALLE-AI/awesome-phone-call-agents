"use client";

import Link from "next/link";
import { useState } from "react";
import type { Disposition, Spoken } from "asheard/disposition";

import { Payload, Readings, Verdict } from "@/components/reading";
import { remember } from "@/lib/queue";

interface Reading {
  disposition: Disposition;
  spoken: Spoken;
  payload: unknown;
}

export default function KeyPage() {
  const [apiKey, setApiKey] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [callId, setCallId] = useState("");
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [cited, setCited] = useState<readonly string[]>([]);

  async function post(body: Record<string, unknown>) {
    return fetch("/api/calle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-calle-key": apiKey.trim() },
      body: JSON.stringify(body),
    });
  }

  async function verify() {
    setWorking(true);
    setError(null);
    setChecked(null);
    try {
      const response = await post({ action: "verify" });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result.detail ?? result.error ?? "That key was refused.");
        return;
      }
      setChecked(result.detail);
    } catch {
      setError("Could not reach CALL-E from here.");
    } finally {
      setWorking(false);
    }
  }

  async function fetchCall() {
    setWorking(true);
    setError(null);
    try {
      const response = await post({ callId });
      const result = await response.json();
      if (!response.ok) {
        setReading(null);
        setError(result.error ?? "That did not work.");
        return;
      }
      remember({
        payload: result.payload,
        disposition: result.disposition,
        spoken: result.spoken,
      });
      setReading(result);
    } catch {
      setError("Could not reach CALL-E from here.");
    } finally {
      setWorking(false);
    }
  }

  if (reading) {
    return (
      <main>
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
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <section
            className="border-b px-6 py-10 md:px-12 lg:border-r lg:border-b-0 lg:px-16 lg:py-14"
            style={{ borderColor: "var(--rule)" }}
          >
            <Readings disposition={reading.disposition} onHover={setCited} />
          </section>
          <aside className="px-6 py-10 md:px-12 lg:px-10 lg:py-14">
            <Payload
              payload={reading.payload}
              cited={cited}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setReading(null);
                    setCallId("");
                  }}
                  className="font-mono text-xs underline underline-offset-4"
                  style={{ color: "var(--paper-faint)" }}
                >
                  another call
                </button>
              }
            />
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header
        className="border-b px-6 pt-16 pb-10 md:px-12 lg:px-16"
        style={{ borderColor: "var(--rule)" }}
      >
        <h1 className="max-w-[22ch] text-4xl leading-[1.05] font-medium sm:text-6xl lg:text-7xl">
          Paste a key. It fetches the call itself.
        </h1>
        <p
          className="mt-6 max-w-[58ch] text-lg leading-relaxed"
          style={{ color: "var(--paper-dim)" }}
        >
          The key is used for one request and kept nowhere. Not in a database, not in a cookie, not
          in a log. It goes when you close the tab.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section
          className="border-b px-6 py-10 md:px-12 lg:border-r lg:border-b-0 lg:px-16 lg:py-14"
          style={{ borderColor: "var(--rule)" }}
        >
          <Field
            id="key"
            label="your call-e key"
            value={apiKey}
            onChange={(value) => {
              setApiKey(value);
              setChecked(null);
            }}
            placeholder="iams_live_..."
            secret
          />

          <div className="mt-6 flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => void verify()}
              disabled={working || apiKey.trim() === ""}
              className="border px-6 py-3 font-mono text-xs tracking-[0.18em] uppercase disabled:opacity-35"
              style={{ borderColor: "var(--paper)" }}
            >
              {working && checked === null ? "checking" : "check the key"}
            </button>
            {checked ? (
              <p className="text-sm" style={{ color: "var(--quoted)" }}>
                {checked}
              </p>
            ) : (
              <p className="text-sm" style={{ color: "var(--paper-faint)" }}>
                Checking reads a call id that cannot exist. No call is placed.
              </p>
            )}
          </div>

          {checked ? (
            <div className="mt-14 border-t pt-10" style={{ borderColor: "var(--rule)" }}>
              <Field
                id="call"
                label="a call id"
                value={callId}
                onChange={setCallId}
                placeholder="call_..."
              />
              <div className="mt-6 flex flex-wrap items-center gap-5">
                <button
                  type="button"
                  onClick={() => void fetchCall()}
                  disabled={working || callId.trim() === ""}
                  className="border px-6 py-3 font-mono text-xs tracking-[0.18em] uppercase disabled:opacity-35"
                  style={{ borderColor: "var(--paper)" }}
                >
                  {working ? "fetching" : "read it"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              className="mt-8 max-w-[62ch] border-l-2 pl-4 text-[15px] leading-relaxed"
              style={{ borderColor: "var(--alarm)", color: "var(--paper-dim)" }}
            >
              {error}
            </p>
          ) : null}
        </section>

        <aside className="px-6 py-10 md:px-12 lg:px-10 lg:py-14">
          <div className="lg:sticky lg:top-8">
            <p
              className="font-mono text-xs tracking-[0.2em] uppercase"
              style={{ color: "var(--paper-faint)" }}
            >
              why you have to type a call id
            </p>
            <div
              className="mt-5 flex flex-col gap-4 text-[15px] leading-relaxed"
              style={{ color: "var(--paper-dim)" }}
            >
              <p>
                There is no list of your recent calls here because the Calls API does not have one.
                A GET to <span className="font-mono text-[13px]">/v1/calls</span> answers{" "}
                <span className="font-mono text-[13px]">405 Method Not Allowed</span>.
              </p>
              <p>
                So a call id is the only handle there is. Lose one and the call is not findable
                again, by us or by you. That is worth knowing before you build something that
                depends on getting a call id back and holding onto it.
              </p>
              <p>
                This page can do two things with your key: check it, and fetch a call. It cannot
                place one. Nothing in this app reaches the endpoint that dials a phone.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  secret,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  secret?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="font-mono text-xs tracking-[0.18em] uppercase"
        style={{ color: "var(--paper-faint)" }}
      >
        {label}
      </label>
      <input
        id={id}
        type={secret ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="mt-4 block w-full max-w-[46rem] border p-4 font-mono text-[13px] outline-none focus:border-[var(--derived)]"
        style={{ borderColor: "var(--rule)", background: "#0e0e10", color: "var(--paper)" }}
      />
    </div>
  );
}
