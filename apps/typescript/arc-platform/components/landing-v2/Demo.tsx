"use client"

import { useEffect, useRef, useState } from "react"

import { DEMO } from "./content"
import { BtnPrimary, Em, Wrap } from "./parts"

/**
 * E. The chat reveals once, on scroll into view.
 *
 * Threshold 0.35, and the observer disconnects the moment it fires - it plays
 * once and never re-arms.
 *
 * Delays are 300ms apart down the list, EXCEPT the green confirm line, which
 * waits 700ms after the total so it reads as the result landing rather than as
 * one more row appearing.
 *
 * Hidden state is opacity + transform only. The elements keep their space
 * before the trigger, so nothing on the page moves when it fires.
 */
const STEP = 300
const D = {
  head: 0,
  you: STEP,
  arc: STEP * 2,
  rows: (i: number) => STEP * (3 + i),
  total: STEP * 6,
  confirm: STEP * 6 + 700,
}

export function Demo() {
  const card = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = card.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        setShown(true)
        io.disconnect()
      },
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section id="demo" className="bg-surface py-16 md:py-24">
      <Wrap className="grid grid-cols-1 items-center gap-14 min-[900px]:grid-cols-[.9fr_1.1fr]">
        <div>
          <h2 className="mb-4 font-display text-h1 text-text">
            {DEMO.title} <Em>{DEMO.titleAccent}</Em>
          </h2>
          <p className="mb-7 text-body text-text-muted">{DEMO.lede}</p>
          <BtnPrimary href="/sign-up">{DEMO.cta}</BtnPrimary>
        </div>

        <div
          ref={card}
          aria-label="Example Arc campaign plan"
          className={[
            "flex flex-col gap-3.5 rounded-card border border-border bg-bg p-6 shadow-card",
            shown ? "chat-in" : "",
          ].join(" ")}
        >
          <div
            className="chat-item type-data flex justify-between border-b border-border pb-3 text-text-muted"
            style={{ animationDelay: `${D.head}ms` }}
          >
            <span>{DEMO.head.left}</span>
            <span>{DEMO.head.right}</span>
          </div>

          <div
            className="chat-item max-w-[88%] self-end rounded-card rounded-br-[4px] bg-primary px-4 py-3 text-small leading-relaxed text-primary-foreground"
            style={{ animationDelay: `${D.you}ms` }}
          >
            {DEMO.you}
          </div>

          <div
            className="chat-item max-w-[88%] self-start rounded-card rounded-bl-[4px] bg-lilac px-4 py-3 text-small leading-relaxed text-ink"
            style={{ animationDelay: `${D.arc}ms` }}
          >
            <b className="font-semibold">{DEMO.arcBold}</b>
            {DEMO.arcRest}
          </div>

          <div className="overflow-hidden rounded-card border border-border text-small">
            {DEMO.plan.map((r, i) => (
              <div
                key={r.b}
                className="chat-item flex items-center justify-between border-b border-border px-4 py-3"
                style={{ animationDelay: `${D.rows(i)}ms` }}
              >
                <span className="flex flex-col">
                  <b className="font-semibold">{r.b}</b>
                  <span className="type-data text-text-muted">{r.s}</span>
                </span>
                <span className="type-data text-text">{r.r}</span>
              </div>
            ))}
            <div
              className="chat-item flex items-center justify-between bg-lilac px-4 py-3"
              style={{ animationDelay: `${D.total}ms` }}
            >
              <span className="flex flex-col">
                <b className="font-semibold">{DEMO.total.b}</b>
                <span className="type-data text-ink/70">{DEMO.total.s}</span>
              </span>
              <span className="type-data text-ink">
                {DEMO.total.r}
              </span>
            </div>
          </div>

          <div
            className="chat-item flex items-center gap-1.5 text-small font-medium text-success"
            style={{ animationDelay: `${D.confirm}ms` }}
          >
            <span aria-hidden>✓</span>
            {DEMO.confirm}
          </div>
        </div>
      </Wrap>
    </section>
  )
}
