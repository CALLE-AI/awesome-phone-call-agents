export default function SupplyLineLogo({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Solid brand-blue circle */}
      <circle cx="20" cy="20" r="19" fill="#1A62FC" />

      {/* Hand-truck / dolly with boxes — all solid white */}
      <g>
        {/* Foot plate — horizontal base of the L-frame */}
        <rect x="10" y="29" width="16" height="2" rx="0.8" fill="#FFFFFF" />

        {/* Upright — vertical back of the L-frame */}
        <rect x="24" y="11" width="2.5" height="20" rx="0.8" fill="#FFFFFF" />

        {/* Handle grip — top of the upright */}
        <rect x="21" y="10" width="8" height="2" rx="1" fill="#FFFFFF" />

        {/* Bottom box (larger) */}
        <rect x="11" y="18" width="12" height="8" rx="1.5" fill="#FFFFFF" />

        {/* Top box (smaller) */}
        <rect x="13" y="11.5" width="8" height="6.5" rx="1.5" fill="#FFFFFF" />

        {/* Wheels */}
        <circle cx="14.5" cy="33" r="2" fill="#FFFFFF" />
        <circle cx="23" cy="33" r="2" fill="#FFFFFF" />
      </g>
    </svg>
  );
}
