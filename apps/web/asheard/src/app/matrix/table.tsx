"use client";

import { useState } from "react";
import type { Cell, CellKind, CoverageRow, Surface } from "asheard/disposition";

function kindColor(kind: CellKind): string {
  if (kind === "yes") return "var(--quoted)";
  if (kind === "derived" || kind === "app") return "var(--derived)";
  if (kind === "collapsed") return "var(--alarm)";
  return "var(--absent)";
}

function label(cell: Cell): string {
  if (cell.kind === "collapsed") return `→ ${cell.collapsedOnto}`;
  if (cell.kind === "none") return "–";
  return cell.kind;
}

/**
 * The table, plus the mapper's reason for whichever cell you are pointing at.
 *
 * A terminal can only print the word. The interesting part is why, and there is
 * room for it here, so picking a cell puts the mapper's own sentence and the
 * fields it read underneath. That sentence is not written on this page. It
 * comes back from the mapping code with the answer.
 */
export function MatrixTable({ rows, surfaces }: { rows: CoverageRow[]; surfaces: Surface[] }) {
  const [picked, setPicked] = useState<Cell | null>(null);

  return (
    <div>
      <div className="overflow-x-auto px-6 md:px-12 lg:px-16">
        <table className="w-full min-w-[44rem] table-fixed border-collapse">
          {/* Fixed layout on purpose. Auto layout hands the slack to whichever
              column has the longest content, which here is the ending names, so
              "busy" ended up with half the screen and the surfaces were squeezed
              against the right edge. The three surfaces are the comparison, so
              they get equal room. */}
          <colgroup>
            <col style={{ width: "28%" }} />
            {surfaces.map((surface) => (
              <col key={surface} style={{ width: `${72 / surfaces.length}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                className="py-4 pr-6 text-left font-mono text-xs font-normal tracking-[0.18em] uppercase"
                style={{ color: "var(--paper-faint)" }}
              >
                ending
              </th>
              {surfaces.map((surface) => (
                <th
                  key={surface}
                  className="py-4 pr-6 text-left font-mono text-xs font-normal tracking-[0.18em] uppercase"
                  style={{ color: "var(--paper-faint)" }}
                >
                  {surface}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ending} className="border-t" style={{ borderColor: "var(--rule)" }}>
                <th
                  scope="row"
                  className="py-5 pr-6 text-left font-mono text-[16px] font-normal"
                >
                  {row.ending}
                </th>
                {row.cells.map((cell) => {
                  const active =
                    picked !== null &&
                    picked.surface === cell.surface &&
                    picked.ending === cell.ending;
                  return (
                    <td key={cell.surface} className="py-5 pr-6 align-top">
                      <button
                        type="button"
                        onClick={() => setPicked(active ? null : cell)}
                        onMouseEnter={() => setPicked(cell)}
                        className="font-mono text-[15px] tracking-[0.06em] lowercase"
                        style={{
                          color: kindColor(cell.kind),
                          textDecoration: active ? "underline" : "none",
                          textUnderlineOffset: "5px",
                        }}
                      >
                        {label(cell)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="border-t px-6 py-8 md:px-12 lg:px-16"
        style={{ borderColor: "var(--rule)", minHeight: "11rem" }}
      >
        {picked === null ? (
          <p className="max-w-[54ch] text-[15px]" style={{ color: "var(--paper-faint)" }}>
            Point at a cell and the mapper will say why it answered that way.
          </p>
        ) : (
          <>
            <p className="font-mono text-xs tracking-[0.16em] uppercase">
              <span style={{ color: "var(--paper-faint)" }}>
                {picked.surface} · {picked.ending} ·{" "}
              </span>
              <span style={{ color: kindColor(picked.kind) }}>{label(picked)}</span>
            </p>
            <p
              className="mt-4 max-w-[76ch] border-l-2 pl-4 text-[15px] leading-relaxed"
              style={{ borderColor: kindColor(picked.kind), color: "var(--paper-dim)" }}
            >
              {picked.note}
            </p>
            {picked.from.length > 0 ? (
              <p className="mt-4 font-mono text-xs" style={{ color: "var(--paper-faint)" }}>
                read from {picked.from.join(", ")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
