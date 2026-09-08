"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Arc Tuner Strip - BRANDING.md v1.1 section 5.
 *
 * The one thing Arc is remembered by: a horizontal segmented band, like an FM
 * dial. Segments at varying widths, separated by 2px --bone gaps, --hairline
 * tick marks above, mono labels below.
 *
 * Built once, reused in two places:
 *   - landing hero: segments are stations, labels are real frequencies
 *   - media plan:   segments are time blocks, widths are actual durations,
 *                   labels are dayparts
 *
 * Because it does a real job in the product it reads as identity rather than
 * decoration - which is why there are NO landing-page-specific props here.
 * Everything is expressed as generic data: a weight, a tone and a label.
 */

/** Tone is a token NAME, never a colour value - see BRANDING.md section 9,
 *  "colours-as-data become token names, mapped in one place". This object is
 *  that one place. */
const TONE_CLASS = {
  lilac: "bg-lilac",
  blush: "bg-blush",
  butter: "bg-butter",
  /** Spent, booked out, unavailable - a segment that is no longer buyable. */
  muted: "bg-hairline",
} as const

export type TunerTone = keyof typeof TONE_CLASS

export interface TunerSegment {
  /** Stable key. */
  id: string
  /** Mono label rendered under the segment - a frequency, or a daypart. */
  label: string
  /** Relative width. Durations, spend, reach - any positive number. */
  weight: number
  tone: TunerTone
  /** Optional second line under the label. */
  caption?: string
}

export interface TunerStripProps extends React.ComponentProps<"div"> {
  segments: TunerSegment[]
  /** Accessible name. The strip is a picture of data, so it needs one. */
  label: string
  /**
   * Fill the segments left-to-right once on mount, then stay still.
   * Off by default: the media-plan use is static. Ignored under
   * prefers-reduced-motion, where segments render already filled.
   */
  animateOnMount?: boolean
  /**
   * "full" - ticks, band and mono labels. The hero and media-plan reading.
   * "band" - the band alone, thin and quiet. For surfaces that need the mark
   *          without the data, such as the auth card.
   */
  variant?: "full" | "band"
}

function TunerStrip({
  segments,
  label,
  animateOnMount = false,
  variant = "full",
  className,
  ...props
}: TunerStripProps) {
  const band = variant === "band"
  const [filled, setFilled] = React.useState(!animateOnMount)

  React.useEffect(() => {
    if (!animateOnMount) return
    // Two frames: one to commit the collapsed state, one to transition from it.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setFilled(true)))
    return () => cancelAnimationFrame(id)
  }, [animateOnMount])

  return (
    <div
      data-slot="tuner-strip"
      role="img"
      aria-label={`${label}: ${segments.map((s) => s.label).join(", ")}`}
      className={cn("flex w-full flex-col", band ? "gap-0" : "gap-2", className)}
      {...props}
    >
      {/* tick marks */}
      {band ? null : (
      <div aria-hidden className="flex w-full gap-[2px]">
        {segments.map((s) => (
          <div key={s.id} style={{ flexGrow: s.weight }} className="flex min-w-0 justify-start">
            <span className="h-2 w-px bg-hairline" />
          </div>
        ))}
      </div>
      )}

      {/* the band - gaps show the --bone page through, so they read as dial gaps */}
      <div
        aria-hidden
        className={cn(
          "flex w-full gap-[2px] overflow-hidden bg-bg",
          band ? "rounded-none" : "rounded-control"
        )}
      >
        {segments.map((s, i) => (
          <div
            key={s.id}
            style={{ flexGrow: s.weight, transitionDelay: filled ? `${i * 70}ms` : "0ms" }}
            className={cn(
              band ? "h-2 min-w-0" : "h-14 min-w-0 sm:h-20",
              "origin-left transition-transform duration-700 ease-out",
              "motion-reduce:scale-x-100 motion-reduce:transition-none",
              filled ? "scale-x-100" : "scale-x-0",
              TONE_CLASS[s.tone]
            )}
          />
        ))}
      </div>

      {/* mono labels */}
      {band ? null : (
      <div aria-hidden className="flex w-full gap-[2px]">
        {segments.map((s) => (
          <div key={s.id} style={{ flexGrow: s.weight }} className="flex min-w-0 flex-col gap-0.5">
            <span className="type-data truncate text-text">{s.label}</span>
            {s.caption ? (
              // Hidden on narrow viewports: with many segments the caption
              // truncates to noise ("City ..."). The label always survives.
              <span className="hidden truncate text-label text-text-muted sm:block">
                {s.caption}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      )}
    </div>
  )
}

export { TunerStrip, TONE_CLASS }
