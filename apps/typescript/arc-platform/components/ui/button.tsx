import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Arc Button - BRANDING.md v1.1 sections 2 / 4.
 *
 * Three variants carry the brief: primary, secondary, ghost. `destructive`,
 * `outline` and `link` are shadcn defaults kept for compatibility.
 *
 * Primary is near-black with white text. Not lilac, not a gradient - the
 * pastels are fields and fills, the black is the action. No shadow on buttons
 * (section 4: the one shadow is for cards only).
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-control border border-transparent bg-clip-padding",
    "font-sans font-medium whitespace-nowrap select-none",
    "transition-colors duration-150 motion-reduce:transition-none",
    // Focus ring: outline follows border-radius and needs no offset colour,
    // so it stays visible on --bone, on white cards and on the black fill.
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-40",
    "aria-invalid:border-destructive",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-butter-deep",
        ghost:
          "text-text hover:bg-lilac/60 aria-expanded:bg-lilac/60",
        outline:
          "border-border bg-surface text-text hover:bg-lilac/40 aria-expanded:bg-lilac/40",
        // Ghost, not a filled pastel. --blush is a decorative field colour;
        // filling a destructive action with it made pink mean both "pretty"
        // and "dangerous". Red text + red focus ring carries the warning, and
        // the pastels stay purely decorative.
        destructive:
          "text-destructive hover:bg-destructive/10 focus-visible:outline-destructive",
        link: "text-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 text-small",
        sm: "h-8 px-3 text-small",
        lg: "h-12 px-6 text-body",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      disabled={asChild ? undefined : disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? (
        <>
          {/* aria-hidden: the label already carries the meaning, and
              motion-reduce swaps the spin for a static ring. */}
          <span
            aria-hidden
            className="size-4 shrink-0 animate-spin rounded-pill border-2 border-current border-t-transparent motion-reduce:animate-none"
          />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
