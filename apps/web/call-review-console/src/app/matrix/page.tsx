import type { Metadata } from "next";
import { CELL_MEANING, type Cell, type CellKind, SURFACES_IN_ORDER, coverage } from "asheard/disposition";

import { MatrixTable } from "./table";

export const metadata: Metadata = {
  title: "What each surface can say",
  description:
    "Which CALL-E surface can express which call ending, computed by running the mappers rather than by writing the table down.",
};

/**
 * Rendered on the server, at request time, by running the mappers.
 *
 * Nothing here is a list of what the library is believed to do. Every cell is
 * an answer a mapper gave a moment ago, with the mapper's own sentence for why.
 * A mapping that loses an ending changes this page without anybody editing it,
 * which is the only way a coverage table is worth reading.
 */
export const dynamic = "force-dynamic";

export default function MatrixPage() {
  const rows = coverage();

  const counts = new Map<CellKind, number>();
  for (const row of rows) {
    for (const c of row.cells) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  }

  const stated = counts.get("yes") ?? 0;
  const total = rows.length * SURFACES_IN_ORDER.length;

  return (
    <main>
      <header
        className="border-b px-6 pt-16 pb-10 md:px-12 lg:px-16"
        style={{ borderColor: "var(--rule)" }}
      >
        <h1 className="max-w-[24ch] text-4xl leading-[1.05] font-medium sm:text-6xl lg:text-7xl">
          {stated} of {total} endings are actually stated.
        </h1>
        <p
          className="mt-6 max-w-[62ch] text-lg leading-relaxed"
          style={{ color: "var(--paper-dim)" }}
        >
          Three ways into the same phone call, and they do not agree about how it ended. This is
          which surface can express which ending. It is computed by running the mappers on this
          request, not written down, so it cannot claim coverage the code does not have.
        </p>
      </header>

      <MatrixTable rows={rows} surfaces={[...SURFACES_IN_ORDER]} />

      <section className="border-t px-6 py-12 md:px-12 lg:px-16" style={{ borderColor: "var(--rule)" }}>
        <p
          className="font-mono text-xs tracking-[0.2em] uppercase"
          style={{ color: "var(--paper-faint)" }}
        >
          what the words mean
        </p>
        <dl className="mt-6 grid gap-x-12 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(CELL_MEANING) as CellKind[])
            .filter((kind) => kind !== "none")
            .map((kind) => (
              <div key={kind}>
                <dt className="font-mono text-xs tracking-[0.16em] uppercase" style={{ color: kindColor(kind) }}>
                  {kind === "collapsed" ? "collapsed onto" : kind}
                </dt>
                <dd className="mt-2 max-w-[42ch] text-[15px] leading-relaxed" style={{ color: "var(--paper-dim)" }}>
                  {CELL_MEANING[kind]}
                </dd>
              </div>
            ))}
        </dl>

        <p className="mt-12 max-w-[68ch] text-[15px] leading-relaxed" style={{ color: "var(--paper-dim)" }}>
          The two rows worth sitting with are <span className="font-mono text-[13px]">no_answer</span>{" "}
          and <span className="font-mono text-[13px]">busy</span>. MCP states both. Goal Runs states
          one and reports the other as a provider fault. The Calls API can reach both, but only by
          reading a code nested on the attempt, in a different vocabulary from the failure code at
          the top of the same object. Pick the wrong surface and a busy line becomes an outage.
        </p>
      </section>
    </main>
  );
}

export function kindColor(kind: CellKind): string {
  if (kind === "yes") return "var(--quoted)";
  if (kind === "derived" || kind === "app") return "var(--derived)";
  if (kind === "collapsed") return "var(--alarm)";
  return "var(--absent)";
}

export type { Cell };
