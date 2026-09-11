import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Arc Textarea - BRANDING.md v1.1 section 4.
 *
 * Deliberately the Input primitive's twin: same radius-control, same hairline
 * border, same focus ring, same aria-invalid error state. Only the height
 * rules and `resize` differ. Keeping the two in step is the point - a second
 * styling path for multi-line text is exactly what the token system exists to
 * prevent.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full resize-y rounded-control border border-border bg-surface px-3.5 py-2.5",
        "font-sans text-body text-text",
        "transition-colors duration-150 motion-reduce:transition-none",
        "placeholder:text-text-muted",
        "outline-none focus-visible:border-ring focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:resize-none disabled:bg-bone disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:focus-visible:outline-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
