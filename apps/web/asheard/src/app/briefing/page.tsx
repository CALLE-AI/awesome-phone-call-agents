import Link from "next/link";

import { normalizeCallsApi } from "asheard/disposition";
import {
  buildEvidence,
  classify,
  headline,
  phrase,
  rankBatch,
  subline,
  withFlags,
  type EventPage,
  type EvidencePackage,
} from "asheard/reconciler";

import stuck from "asheard/fixtures/reconciler/stuck-queued-never-dialled.json";
import replayed from "asheard/fixtures/reconciler/replayed-idempotent-create.json";
import clock from "asheard/fixtures/reconciler/clock-disagrees-naive-attempt.json";
import voicemail from "asheard/fixtures/calls-api/completed-voicemail-task-completed.json";
import ranOut from "asheard/fixtures/calls-api/failed-with-synthesized-result.json";
import busy from "asheard/fixtures/calls-api/failed-busy-attempt-486.json";
import success from "asheard/fixtures/calls-api/completed-genuine-success.json";
import answeredBy from "asheard/fixtures/calls-api/completed-answered-by-voicemail.json";

import confirmed from "asheard/fixtures/reconciler/routine-confirmed-appointment.json";
import stock from "asheard/fixtures/reconciler/routine-stock-check.json";
import hours from "asheard/fixtures/reconciler/routine-opening-hours.json";
import callback from "asheard/fixtures/reconciler/routine-callback-agreed.json";

import { Diamond, Label } from "@/components/glyphs";

/**
 * A morning's calls, in the order somebody should deal with them.
 *
 * This is the half of the product a single call cannot show. One call tells
 * you what happened to that call. A batch tells you which three out of twelve
 * are going to cost you something, and lets the other nine collapse into a
 * line so they stop competing for attention.
 *
 * Every call here comes from a fixture and the page says so. The stuck and
 * replayed cases cannot be produced on demand, so they are written from the
 * open issues that report them rather than staged and passed off as live.
 */

export const metadata = {
  title: "The morning briefing",
  description:
    "A batch of calls, worst first, in plain English. Three of these need you today and the rest collapse into one line.",
};

interface Bundle {
  call: unknown;
  events?: EventPage;
  requestedAt?: string;
}

/**
 * Fixtures that carry their own event stream alongside the call.
 *
 * The four routine ones are here on purpose. A briefing assembled only from
 * defects would read as though everything is broken, which is both untrue and
 * the fastest way to get a tool like this switched off. They are also the
 * product argument in miniature: each declares the answered-by field CALL-E's
 * guide tells you to ask for, and that alone is what keeps them off the list.
 */
const BUNDLED = [
  stuck,
  replayed,
  clock,
  confirmed,
  stock,
  hours,
  callback,
] as unknown as Bundle[];

/** Plain call payloads, no event stream. */
const PLAIN = [voicemail, ranOut, busy, success, answeredBy];

/**
 * Fixed so the page reads the same every time.
 *
 * The stuck detector measures against the clock, so a real `new Date()` would
 * make this page say something different every morning and there would be no
 * way to tell a rendering bug from the passage of time.
 */
const NOW = new Date("2000-01-06T12:00:00Z");

function packages(): EvidencePackage[] {
  const out: EvidencePackage[] = [];

  for (const b of BUNDLED) {
    const read = normalizeCallsApi(b.call as never);
    const built = buildEvidence({
      payload: b.call,
      events: b.events ? [b.events] : [],
      read,
      now: () => NOW,
    });
    out.push(withFlags(built, { now: () => NOW, requestedAt: b.requestedAt }));
  }

  for (const payload of PLAIN) {
    const read = normalizeCallsApi(payload as never);
    const built = buildEvidence({ payload, read, now: () => NOW });
    out.push(withFlags(built, { now: () => NOW }));
  }

  return out;
}

export default function Briefing() {
  const all = packages();
  const briefing = rankBatch(all);
  const top = headline(briefing.needing, briefing.total);
  const rest = subline(briefing.routine.length);

  return (
    <main className="flex-1 px-6 py-16 md:px-12 md:py-24">
      <div className="mx-auto max-w-4xl">
        <Label>The morning briefing</Label>

        <h1 className="mt-8 text-4xl font-semibold leading-tight md:text-5xl">{top}</h1>
        {rest ? (
          <p className="mt-3 text-xl" style={{ color: "var(--paper-dim)" }}>
            {rest}
          </p>
        ) : null}

        <p className="mt-6 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--paper-dim)" }}>
          Worst first, and worst means what costs you something if you ignore it, not what looks
          most broken. Open any line to see the fields it was read from. Nothing here is a
          percentage.
        </p>

        <div className="mt-14 space-y-14">
          {briefing.groups.map((group) => (
            <section key={group.band}>
              <h2 className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.22em]" style={{ color: "var(--signal)" }}>
                <Diamond size={12} />
                {group.heading}
              </h2>

              <ul className="mt-6 space-y-px" style={{ background: "var(--rule)" }}>
                {group.items.map((item, i) => {
                  const spoken = phrase(item);
                  return (
                    <li key={i} style={{ background: "var(--ground-2)" }}>
                      <details className="group">
                        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-4 p-5 transition hover:bg-[var(--ground-3)]">
                          <span className="text-lg leading-snug">
                            {spoken.line || item.because.summary}
                          </span>
                          <span
                            className="font-mono text-[11px] uppercase tracking-[0.15em]"
                            style={{ color: "var(--paper-faint)" }}
                          >
                            {item.pkg.callId?.value.slice(0, 22) ?? "no id"}
                          </span>
                        </summary>

                        <div className="border-t px-5 pb-6 pt-5" style={{ borderColor: "var(--rule)" }}>
                          <p className="text-sm leading-relaxed" style={{ color: "var(--paper-dim)" }}>
                            {item.because.summary}
                          </p>
                          <p className="mt-2 font-mono text-[11px]" style={{ color: "var(--paper-faint)" }}>
                            read from {item.because.from.join(", ")}
                          </p>

                          <dl className="mt-6 grid gap-4 sm:grid-cols-3">
                            <Axis label="How it ended" a={item.pkg.read.endstate} />
                            <Axis label="Job done" a={item.pkg.read.taskOutcome} />
                            <Axis label="Where the answer came from" a={item.pkg.read.resultState} />
                          </dl>

                          {spoken.notes.length > 0 ? (
                            <ul className="mt-6 space-y-3">
                              {spoken.notes.map((n, j) => (
                                <li
                                  key={j}
                                  className="border-l-2 pl-4 text-sm leading-relaxed"
                                  style={{ borderColor: "var(--signal)", color: "var(--paper-dim)" }}
                                >
                                  {n}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {briefing.routine.length > 0 ? (
            <section>
              <h2 className="font-mono text-xs uppercase tracking-[0.22em]" style={{ color: "var(--paper-faint)" }}>
                Behaved as expected
              </h2>
              <p className="mt-4 p-5 text-lg" style={{ background: "var(--ground-2)", color: "var(--paper-dim)" }}>
                {rest} Nothing in them needs a person, so they are one line instead of{" "}
                {briefing.routine.length}.
              </p>
            </section>
          ) : null}
        </div>

        <div className="mt-16 border-t pt-8" style={{ borderColor: "var(--rule)" }}>
          <p className="text-sm leading-relaxed" style={{ color: "var(--paper-dim)" }}>
            These are fixtures, and that is deliberate. A call stuck in the queue and a call that
            went out twice cannot be produced on demand, so they are written from the open reports
            that describe them rather than staged and passed off as live.{" "}
            <Link href="/live" className="underline" style={{ color: "var(--signal)" }}>
              The live page
            </Link>{" "}
            dials a real number instead.
          </p>
        </div>
      </div>
    </main>
  );
}

function Axis({
  label,
  a,
}: {
  label: string;
  a: { value: string; basis: string; from: string[]; note: string };
}) {
  const colour =
    a.basis === "quoted" ? "var(--quoted)" : a.basis === "derived" ? "var(--signal)" : "var(--absent)";
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--paper-faint)" }}>
        {label}
      </dt>
      <dd className="mt-1">
        <span className="font-mono text-sm">{a.value}</span>{" "}
        <span className="font-mono text-[11px]" style={{ color: colour }}>
          {a.basis}
        </span>
        <p className="mt-1 font-mono text-[11px] leading-relaxed" style={{ color: "var(--paper-faint)" }}>
          {a.from.length > 0 ? a.from.join(", ") : "no field carries this"}
        </p>
      </dd>
    </div>
  );
}
