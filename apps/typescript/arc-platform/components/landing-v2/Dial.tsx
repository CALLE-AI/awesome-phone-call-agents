"use client"

import { DIAL } from "./content"
import { useReducedMotion } from "./use-reduced-motion"

/**
 * C. Horizontal marquee over all twelve stations - this is the strip that says
 * what Arc covers, so it is the one place a station may appear alongside the
 * others.
 *
 * The second copy exists ONLY to close the loop. It is aria-hidden so the list
 * is announced once, the row never wraps, and the track is clipped - if a
 * reader can ever see the same station twice at once, one of those three has
 * broken.
 *
 * Under reduced motion the duplicate is not rendered at all: nothing scrolls,
 * so a second copy would just be the list printed twice.
 */
function Strip({ dup = false }: { dup?: boolean }) {
  return (
    <>
      {DIAL.map((s) => (
        <span
          key={`${dup ? "d-" : ""}${s.freq}`}
          className="mr-[52px] flex shrink-0 items-baseline gap-[9px] whitespace-nowrap"
        >
          <span className="type-data text-lilac-deep">{s.freq}</span>
          <span className="text-small font-medium text-text">{s.name}</span>
          <span className="text-small text-text-muted">{s.cities}</span>
        </span>
      ))}
    </>
  )
}

export function Dial() {
  const reduced = useReducedMotion()

  return (
    <div className="dial overflow-hidden border-y border-border bg-surface py-5">
      {/* NO `gap` on the track. With gap the width is 24 items plus 23 gaps, so
          half of it is one copy PLUS half a gap and translateX(-50%) lands
          short - a visible jump on every loop. Each item carries its own
          trailing margin, which makes one copy exactly half. */}
      <div className="dial-track flex w-max flex-nowrap">
        <Strip />
        {!reduced && (
          <span aria-hidden="true" className="flex flex-nowrap">
            <Strip dup />
          </span>
        )}
      </div>
    </div>
  )
}
