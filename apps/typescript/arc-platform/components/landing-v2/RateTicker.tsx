"use client"

import { RATE_DESK } from "./content"
import { useReducedMotion } from "./use-reduced-motion"

/**
 * A. Vertical ticker over the five rate-desk entries.
 *
 * Same contract as the dial: the second copy closes the loop, is aria-hidden
 * so the list is announced once, and lives inside a clipped mask. Under
 * reduced motion it is not rendered - nothing scrolls, so a duplicate would
 * simply be the list twice.
 */
function Row({ r }: { r: (typeof RATE_DESK.rows)[number] }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border px-0.5 py-4">
      <div>
        <div className="text-small font-medium text-text">{r.who}</div>
        <div className="text-small text-text-muted">{r.what}</div>
      </div>
      <div className="flex flex-col gap-0.5 text-right">
        <span className="type-data whitespace-nowrap text-text">{r.rate}</span>
        <span className="type-data whitespace-nowrap text-text-muted">{r.when}</span>
      </div>
    </div>
  )
}

export function RateTicker() {
  const reduced = useReducedMotion()

  return (
    /* Fixed height so the loop has a window: five rows on desktop, four on a
       phone. overflow-hidden is what keeps the duplicate out of sight. */
    <div className="ticker-mask relative h-[280px] overflow-hidden min-[900px]:h-[340px]">
      <div className="ticker">
        {RATE_DESK.rows.map((r) => (
          <Row key={r.who} r={r} />
        ))}
        {!reduced && (
          <div aria-hidden="true">
            {RATE_DESK.rows.map((r) => (
              <Row key={`dup-${r.who}`} r={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
