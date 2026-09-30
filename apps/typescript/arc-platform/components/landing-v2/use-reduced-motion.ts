"use client"

import { useEffect, useState } from "react"

/**
 * Starts FALSE on purpose.
 *
 * The server cannot know the preference, so it always renders the duplicated
 * marquee copy. If this returned true on the first client render the tree
 * would not match what the server sent and React would report a hydration
 * mismatch. It flips after mount instead, and the duplicate is dropped then -
 * which is invisible either way, because under reduced motion nothing is
 * moving and the second copy is never reached.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  return reduced
}
