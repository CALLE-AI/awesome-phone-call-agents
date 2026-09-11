import Link from "next/link";

import { Diamond, GlyphField, Hexagon, Label, RingOut, Triangle, Waveform } from "@/components/glyphs";

/**
 * The front door.
 *
 * It has one job: make somebody who has never seen a CALL-E payload understand,
 * in about four seconds, that a call can come back green and have gone nowhere.
 * Everything else on the page is in service of that, and the proof is one click
 * away rather than three paragraphs down.
 */

export const metadata = {
  title: "Did that call actually happen?",
  description:
    "A phone call can come back finished, with the job marked done and a confident score on it, and still have reached a recording. This reads what really happened, and shows the field it read.",
};

export default function Home() {
  return (
    <main className="flex-1">
      {/* Hero ------------------------------------------------------------ */}
      <section className="relative overflow-hidden border-b" style={{ borderColor: "var(--rule)" }}>
        <GlyphField />
        <RingOut />

        <div className="relative mx-auto max-w-6xl px-6 py-24 md:px-12 md:py-32">
          <div className="max-w-3xl lg:max-w-2xl">
            <Label>Built on CALL-E</Label>

            <h1 className="rise mt-8 text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
              A call can come back
              <span className="relative mx-3 inline-block">
                <span style={{ color: "var(--signal)" }}>perfect</span>
                <span
                  className="absolute inset-x-0 -bottom-1 block h-[3px]"
                  style={{ background: "var(--signal)", opacity: 0.35 }}
                />
              </span>
              and have gone nowhere.
            </h1>

            <p
              className="rise mt-8 max-w-2xl text-xl leading-relaxed"
              style={{ color: "var(--paper-dim)", animationDelay: "0.1s" }}
            >
              Finished. Job marked done. Confidence nine out of ten. A schema-perfect answer sitting
              right there in the response. And an answering machine on the other end, which nothing
              in the payload will tell you.
            </p>

            <p
              className="rise mt-4 max-w-2xl text-xl leading-relaxed"
              style={{ color: "var(--paper-dim)", animationDelay: "0.16s" }}
            >
              This reads what actually happened, and points at the field it read it from.
            </p>

            <div className="rise mt-10 flex flex-wrap items-center gap-4" style={{ animationDelay: "0.24s" }}>
              <Link
                href="/live"
                className="group relative inline-flex items-center gap-3 overflow-hidden px-7 py-4 text-sm font-medium transition"
                style={{ background: "var(--signal)", color: "var(--ground)", borderRadius: 8 }}
              >
                Ring a real number
                <Waveform bars={5} />
              </Link>
              <Link
                href="/read"
                className="inline-flex items-center gap-2 px-6 py-4 text-sm font-medium transition hover:opacity-70"
                style={{ border: "1px solid var(--rule)", borderRadius: 8, color: "var(--paper)" }}
              >
                Paste a payload instead
              </Link>
            </div>

            <p className="mt-6 font-mono text-xs" style={{ color: "var(--paper-faint)" }}>
              No sign in. Nothing stored. The numbers it can dial belong to nobody.
            </p>
          </div>
        </div>
      </section>

      {/* The disagreement ------------------------------------------------ */}
      <section className="border-b px-6 py-20 md:px-12 md:py-28" style={{ borderColor: "var(--rule)" }}>
        <div className="mx-auto max-w-6xl">
          <Label>The same call, twice over</Label>
          <h2 className="mt-6 max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">
            One of these is what you get. The other is what happened.
          </h2>

          <div className="mt-12 grid gap-px lg:grid-cols-2" style={{ background: "var(--rule)" }}>
            <div className="p-8" style={{ background: "var(--ground-2)" }}>
              <p className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: "var(--paper-faint)" }}>
                What the API returns
              </p>
              <dl className="mt-7 space-y-5 font-mono text-sm">
                {[
                  ["status", "completed"],
                  ["task_completed", "true"],
                  ["completion_confidence", "0.9 high"],
                  ["structured_result", "present"],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-wrap items-baseline justify-between gap-3">
                    <dt style={{ color: "var(--paper-faint)" }}>{k}</dt>
                    <dd style={{ color: "var(--quoted)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-8 text-sm leading-relaxed" style={{ color: "var(--paper-dim)" }}>
                Every light is green. This is the shape almost every integration branches on.
              </p>
            </div>

            <div className="relative p-8" style={{ background: "var(--ground-3)" }}>
              <p className="font-mono text-xs uppercase tracking-[0.18em]" style={{ color: "var(--paper-faint)" }}>
                What happened
              </p>
              <p className="mt-7 text-2xl font-medium leading-snug">
                A recording picked up. The job was reported done.
              </p>
              <p className="mt-4 text-lg" style={{ color: "var(--signal)" }}>
                Nobody can say a person was on the line.
              </p>
              <p className="mt-8 font-mono text-xs leading-relaxed" style={{ color: "var(--paper-faint)" }}>
                read from recipients[0].structured_result.answered_by
                <br />
                read from task_completed
              </p>
              <p className="mt-6 text-sm leading-relaxed" style={{ color: "var(--paper-dim)" }}>
                Same payload. Nothing added, nothing guessed. Every sentence points at the field
                underneath it, and where no field carries the answer it says that instead.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Three things ---------------------------------------------------- */}
      <section className="border-b px-6 py-20 md:px-12 md:py-28" style={{ borderColor: "var(--rule)" }}>
        <div className="mx-auto max-w-6xl">
          <Label>What it does</Label>

          <div className="mt-12 grid gap-px md:grid-cols-3" style={{ background: "var(--rule)" }}>
            {[
              {
                n: "01",
                Shape: Hexagon,
                title: "Splits the one word into three",
                body: "How the call ended, whether the job got done, and whether the answer came from anybody speaking. A status field jams all three together, and that is where the money leaks.",
              },
              {
                n: "02",
                Shape: Diamond,
                title: "Says what it cannot see",
                body: "The API carries no answered-by field unless you ask for one. So when nothing establishes a person, it says so plainly and names the one field to add. It nags with the fix attached.",
              },
              {
                n: "03",
                Shape: Triangle,
                title: "Catches the calls nobody is watching",
                body: "Queued for forty minutes with nothing dialled. A repeat that looked like a new call. A duration the event stream flatly contradicts. Each one is somebody's open bug report, written as a check that runs.",
              },
            ].map(({ n, Shape, title, body }) => (
              <div key={n} className="p-8" style={{ background: "var(--ground-2)" }}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs" style={{ color: "var(--paper-faint)" }}>
                    {n}
                  </span>
                  <span style={{ color: "var(--signal)" }}>
                    <Shape size={22} />
                  </span>
                </div>
                <h3 className="mt-8 text-xl font-semibold leading-snug">{title}</h3>
                <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--paper-dim)" }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Close ----------------------------------------------------------- */}
      <section className="relative overflow-hidden px-6 py-24 md:px-12 md:py-32">
        <GlyphField />
        <div className="relative mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <Label>Try it</Label>
            <h2 className="mt-6 text-4xl font-semibold leading-tight md:text-5xl">
              Two calls, one question apart.
            </h2>
            <p className="mt-6 text-lg leading-relaxed" style={{ color: "var(--paper-dim)" }}>
              Two calls to the same number, one asking who picked up and one not. Both come back
              finished with the job marked done. Only one of them can tell you a recording answered.
            </p>
            <Link
              href="/live"
              className="mt-10 inline-flex items-center gap-3 px-7 py-4 text-sm font-medium"
              style={{ background: "var(--signal)", color: "var(--ground)", borderRadius: 8 }}
            >
              Place both calls
              <Waveform bars={5} />
            </Link>
            <p className="mt-6 font-mono text-xs" style={{ color: "var(--paper-faint)" }}>
              Dialling needs an operator token, and only goes to lines no person answers.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
