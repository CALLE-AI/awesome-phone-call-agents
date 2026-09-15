import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Arc Mark - BRANDING.md v1.1 section 3, "Highlight marker".
 *
 * A butter-yellow block behind key words. Inline, --butter background,
 * ~0.15em padding, 4px radius, sitting behind the text baseline.
 *
 * USE AT MOST ONCE PER SCREEN. The brief is explicit: "It stops working the
 * moment it repeats." There is no variant prop and no colour prop on purpose -
 * a second colour would make it decoration rather than emphasis.
 *
 * Renders a semantic <mark>, with the browser default background reset so the
 * token is the only source of colour.
 */
function Mark({ className, ...props }: React.ComponentProps<"mark">) {
  return (
    <mark
      data-slot="mark"
      className={cn(
        "bg-butter text-ink",
        "rounded-[4px] px-[0.15em] py-[0.15em]",
        "box-decoration-clone",
        className
      )}
      {...props}
    />
  )
}

export { Mark }
