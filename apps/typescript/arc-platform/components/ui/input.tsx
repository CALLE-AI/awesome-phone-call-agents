import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Arc Input - BRANDING.md v1.1 section 4.
 * radius-control, no shadow, visible focus ring. Error state is driven by
 * `aria-invalid` so the styling and the accessibility signal cannot drift.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3.5 py-2",
        "font-sans text-body text-text",
        "transition-colors duration-150 motion-reduce:transition-none",
        "placeholder:text-text-muted",
        "outline-none focus-visible:border-ring focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-bone disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:focus-visible:outline-solid aria-invalid:focus-visible:outline-destructive",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-small file:font-medium file:text-text",
        className
      )}
      {...props}
    />
  )
}

export { Input }
