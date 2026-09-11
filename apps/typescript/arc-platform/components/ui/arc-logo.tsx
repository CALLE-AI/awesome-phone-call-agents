import { cn } from "@/lib/utils"

/**
 * The Arc wordmark.
 *
 * Drawn from the supplied lockup (public/arc-lockup-light.svg), cropped to the
 * letterforms alone. The source is an 800x540 card carrying a background
 * panel and two lines of tagline - correct for a title slide, wrong for a
 * 40px-tall header, where the type would be illegible and the panel would
 * fight the page. Only the glyphs are here; the full lockup is still in
 * public/ for anywhere it is wanted whole.
 *
 * The viewBox is the measured bounds of the strokes after the source's
 * translate(69,50) scale(1.5), rounded outward so nothing clips: the round
 * line caps extend half a stroke past each endpoint, which is easy to forget
 * and shows up as a shaved edge.
 *
 * The three dark letterforms use currentColor so the mark works on paper and
 * on the ink panels. The closing arc keeps the brand gradient - it is the one
 * piece of colour in the mark and the thing that makes it Arc's.
 */
export function ArcLogo({
  className,
  gradientId = "arc-logo-aurora",
}: {
  className?: string
  /** Override when several instances share a page and duplicate ids matter. */
  gradientId?: string
}) {
  return (
    <svg
      viewBox="128 184 544 186"
      role="img"
      aria-label="Arc"
      className={cn("h-6 w-auto", className)}
      fill="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#2BB8A8" />
        </linearGradient>
      </defs>
      <g transform="translate(69,50) scale(1.5)" strokeLinecap="round" fill="none">
        <circle cx="100" cy="150" r="48" stroke="currentColor" strokeWidth="24" />
        <line x1="148" y1="102" x2="148" y2="200" stroke="currentColor" strokeWidth="24" />
        <line x1="212" y1="102" x2="212" y2="200" stroke="currentColor" strokeWidth="24" />
        <path d="M212,150 A48,48 0 0 1 260,102" stroke="currentColor" strokeWidth="24" />
        <path d="M386,116 A48,48 0 1 0 386,184" stroke={`url(#${gradientId})`} strokeWidth="24" />
        <circle cx="386" cy="116" r="15" fill="#2BB8A8" stroke="none" />
      </g>
    </svg>
  )
}
