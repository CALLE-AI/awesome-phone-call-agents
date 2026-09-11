/**
 * The shapes.
 *
 * All of them are polygons on purpose, because a phone call is a thing with
 * corners: it starts, it rings, it connects or it does not, it ends. Circles
 * would say "soft product". These say "state machine", which is what this is.
 *
 * Everything here is inline SVG. No icon font, no sprite sheet, nothing that
 * needs a network round trip to render, and each one takes a `size` so it can
 * sit in a heading or a footer without being rescaled by CSS.
 */

export function Hexagon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Diamond({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon points="12,2 22,12 12,22 2,12" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Triangle({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon points="12,3 22,20 2,20" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Their motif: a small filled square in front of a mono label. */
export function Marker({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[9px] w-[9px] shrink-0 ${className}`}
      style={{ background: "var(--signal)" }}
    />
  );
}

/** A mono, uppercase, letter-spaced section label with the square in front. */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.22em] text-[var(--paper-faint)]">
      <Marker />
      {children}
    </p>
  );
}

/**
 * The ring: three nested hexagons pushing outward on a stagger.
 *
 * It is the only thing on the page that loops forever, and it earns it by
 * being the subject. Everything else animates once when you reach it.
 */
export function RingOut({ size = 340 }: { size?: number }) {
  return (
    // Parked on the right so it never crosses the headline. The stroke is set
    // in viewBox units and multiplies by size/24 on render, so 0.12 here is
    // about 1.7px on screen. An earlier 0.35 came out at six and drew over the
    // copy like a fence.
    <div
      className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 items-center justify-center lg:flex"
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <svg
          key={i}
          width={size}
          height={size}
          viewBox="0 0 24 24"
          className="callring absolute"
          style={{ animationDelay: `${i * 1.2}s`, color: "var(--signal)", opacity: 0.5 }}
        >
          <polygon
            points="12,1 22,6.5 22,17.5 12,23 2,17.5 2,6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.12"
          />
        </svg>
      ))}
    </div>
  );
}

/** The waveform from their calling button, as a row of bars. */
export function Waveform({ bars = 9, className = "" }: { bars?: number; className?: string }) {
  const heights = [10, 18, 26, 16, 30, 14, 24, 12, 20];
  return (
    <span className={`inline-flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="wavebar block w-[3px] rounded-full"
          style={{
            height: heights[i % heights.length],
            background: "currentColor",
            animationDelay: `${(i % 5) * 0.13}s`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * The scattered polygon field behind the hero.
 *
 * Positions are fixed rather than random so the page renders the same on the
 * server and the client, and so it looks the same in a screenshot twice.
 */
const FIELD = [
  // Kept to the margins on purpose. An earlier set put a hexagon directly
  // behind the section label and it read as a smudge on the type.
  { left: "2%", top: "6%", size: 26, delay: 0, Shape: Hexagon, opacity: 0.2 },
  { left: "94%", top: "10%", size: 18, delay: 1.4, Shape: Diamond, opacity: 0.16 },
  { left: "3%", top: "90%", size: 20, delay: 2.6, Shape: Triangle, opacity: 0.14 },
  { left: "91%", top: "78%", size: 30, delay: 0.8, Shape: Hexagon, opacity: 0.18 },
  { left: "52%", top: "4%", size: 14, delay: 3.2, Shape: Diamond, opacity: 0.12 },
  { left: "96%", top: "46%", size: 16, delay: 2.2, Shape: Diamond, opacity: 0.14 },
];

export function GlyphField() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {FIELD.map(({ left, top, size, delay, Shape, opacity }, i) => (
        <span
          key={i}
          className="glyph absolute"
          style={{ left, top, opacity, animationDelay: `${delay}s`, color: "var(--signal)" }}
        >
          <Shape size={size} />
        </span>
      ))}
    </div>
  );
}
