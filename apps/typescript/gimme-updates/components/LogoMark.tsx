/**
 * Simple monochrome mark: a small dot (the "call") with radiating arcs
 * (the "ring"), echoing the hero section's ringing-phone animation.
 * Works at favicon scale. See also app/icon.svg, which is the same
 * shape as a static file (favicons can't import a React component).
 */
export function LogoMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="16" r="2.5" fill="#0A0A0A" />
      <path
        d="M12 10.8 A6 6 0 0 1 12 21.2"
        stroke="#0A0A0A"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M14 7.3 A10 10 0 0 1 14 24.7"
        stroke="#0A0A0A"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.6"
      />
      <path
        d="M16 3.9 A14 14 0 0 1 16 28.1"
        stroke="#0A0A0A"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.35"
      />
    </svg>
  );
}
