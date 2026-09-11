import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * Arc's type scale renames the font-size utilities (text-display, text-h1,
 * text-body, text-small, text-label, text-data - BRANDING.md v1.1 section 3).
 *
 * tailwind-merge only knows Tailwind's stock scale, so it classified those
 * names as text-COLOUR utilities. That put `text-small` and
 * `text-primary-foreground` in the same conflict group, and the later one won:
 * every primary Button rendered ink-on-ink, invisible.
 *
 * Registering the scale as font-size restores the two separate groups, so a
 * size class and a colour class can coexist on one element.
 */
const ARC_FONT_SIZES = [
  "display",
  "h1",
  "h2",
  "h3",
  "body",
  "small",
  "label",
  "data",
]

export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ARC_FONT_SIZES }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
