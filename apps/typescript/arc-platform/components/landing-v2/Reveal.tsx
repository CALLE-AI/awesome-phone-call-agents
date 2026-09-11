"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Fade-and-rise on first scroll into view.
 *
 * Deliberately one effect, used everywhere, rather than a different flourish
 * per section - the page argues for consistency and it should look consistent.
 *
 * Two rules it will not break:
 *
 *   Nothing is hidden from a reader who cannot see the animation. The observer
 *   is set up in an effect, so if JavaScript never runs the element keeps the
 *   visible class it was rendered with. A page whose content depends on an
 *   IntersectionObserver is a page that is blank for some people.
 *
 *   prefers-reduced-motion is honoured by skipping the transition entirely,
 *   not by shortening it.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  /** ms. For staggering siblings - keep it under ~300 or it reads as lag. */
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  /* Starts true so server-rendered HTML is visible; the effect below is what
     decides to animate, and only when it can. */
  const [shown, setShown] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (typeof IntersectionObserver === "undefined") return

    setShown(false)
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setShown(true)
        io.disconnect()
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={shown ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
        className
      )}
    >
      {children}
    </div>
  )
}
