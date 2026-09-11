import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Arc Badge / Pill - BRANDING.md v1.1 sections 2 / 4.
 *
 * radius-pill. The pastel variants exist because section 2's density rule
 * names status pills as one of the three places pastel is allowed inside the
 * authenticated app (with chart fills and the tuner strip).
 */
const badgeVariants = cva(
  [
    "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden",
    "h-6 rounded-pill border border-transparent px-2.5",
    "font-sans text-label font-medium tracking-[0.04em] uppercase whitespace-nowrap",
    "transition-colors duration-150 motion-reduce:transition-none",
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "[&>svg]:pointer-events-none [&>svg]:size-3!",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        lilac: "bg-lilac text-ink",
        blush: "bg-blush text-ink",
        butter: "bg-butter text-ink",
        outline: "border-border bg-surface text-text",
        // bg-bone on a --bone page left no visible pill; the hairline
        // border restores the shape without adding a fill.
        muted: "border-border bg-bone text-text-muted",
        // Outlined with muted text. Sat next to the blush "awaiting rate"
        // pill in the PlanRow table, a pink failure pill was unreadable as
        // failure - both said "pink". Outlined + muted reads as "no data",
        // which is what an unreachable station actually is.
        destructive: "border-border bg-transparent text-text-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
