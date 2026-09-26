/**
 * Concentric rings radiating outward from a small centered phone icon,
 * suggesting a phone gently "ringing out". Pure CSS animation (see
 * .hero-ring / .hero-phone rules in app/globals.css): the 3 rings loop
 * continuously on a slow, staggered cycle, and the whole thing is
 * skipped in favor of a static state when the user prefers reduced
 * motion. No JS needed.
 */
export function HeroRingAnimation() {
  return (
    <div className="mx-auto h-[180px] w-[180px] sm:h-[240px] sm:w-[240px]">
      <svg
        viewBox="0 0 240 240"
        className="h-full w-full"
        role="img"
        aria-label="Illustration of a phone ringing, with sound waves radiating outward"
      >
        <circle
          className="hero-ring hero-ring-3"
          cx="120"
          cy="120"
          r="106"
          fill="none"
          stroke="#0A0A0A"
          strokeWidth="1"
        />
        <circle
          className="hero-ring hero-ring-2"
          cx="120"
          cy="120"
          r="76"
          fill="none"
          stroke="#0A0A0A"
          strokeWidth="1"
        />
        <circle
          className="hero-ring hero-ring-1"
          cx="120"
          cy="120"
          r="46"
          fill="none"
          stroke="#0A0A0A"
          strokeWidth="1"
        />
        <g className="hero-phone">
          <rect
            x="104"
            y="90"
            width="32"
            height="60"
            rx="6"
            fill="none"
            stroke="#0A0A0A"
            strokeWidth="2"
          />
          <line
            x1="114"
            y1="100"
            x2="126"
            y2="100"
            stroke="#0A0A0A"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="120" cy="138" r="2.5" fill="#0A0A0A" />
        </g>
      </svg>
    </div>
  );
}
