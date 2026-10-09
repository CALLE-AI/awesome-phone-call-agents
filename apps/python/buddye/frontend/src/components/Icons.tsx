/** Stroke SVG icons, used only where they carry state (a phone, a warning, a closed door). */

type IconProps = { size?: number; color?: string; className?: string }

function svg(size: number, children: React.ReactNode, extra?: string, className?: string, color = 'currentColor') {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke={color}
      strokeWidth={extra ?? '1.75'}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function PhoneIcon({ size = 16, color, className }: IconProps) {
  return svg(
    size,
    <path d="M4 3.5h3l1.5 3.5-2 1.2a9 9 0 0 0 5.3 5.3l1.2-2 3.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A13.5 13.5 0 0 1 2.5 5.1 1.5 1.5 0 0 1 4 3.5z" />,
    undefined,
    className,
    color,
  )
}

/** A phone with a line through it: rang, nobody answered. */
export function PhoneMissedIcon({ size = 16, color, className }: IconProps) {
  return svg(
    size,
    <>
      <path d="M4 3.5h3l1.5 3.5-2 1.2a9 9 0 0 0 5.3 5.3l1.2-2 3.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A13.5 13.5 0 0 1 2.5 5.1 1.5 1.5 0 0 1 4 3.5z" />
      <path d="M2.5 17.5 17.5 2.5" />
    </>,
    undefined,
    className,
    color,
  )
}

export function CheckIcon({ size = 14, color = '#2f8a5b', className }: IconProps) {
  return svg(size, <path d="M4.5 10.4l3.2 3.2L15.5 5.8" />, undefined, className, color)
}

export function CheckCircleIcon({ size = 18, color = '#2f8a5b', className }: IconProps) {
  return svg(
    size,
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M6.5 10.3l2.3 2.3 4.7-5" />
    </>,
    '2',
    className,
    color,
  )
}

export function AlertIcon({ size = 18, color, className }: IconProps) {
  return svg(
    size,
    <>
      <path d="M10 2.6 18.4 17H1.6L10 2.6z" />
      <path d="M10 8v3.6" />
      <path d="M10 14.2h.01" />
    </>,
    undefined,
    className,
    color,
  )
}

/** A bolt: power, and by extension anything power-dependent. */
export function BoltIcon({ size = 16, color, className }: IconProps) {
  return svg(size, <path d="M11 1.5 4 11h5l-1 7.5L16 9h-5l0-7.5z" />, undefined, className, color)
}

export function ChevronIcon({ size = 16, color, className }: IconProps) {
  return svg(size, <path d="M7.5 4.5 13 10l-5.5 5.5" />, undefined, className, color)
}

export function ArrowIcon({ size = 16, color, className }: IconProps) {
  return svg(size, <path d="M3.5 10h12M11.5 6l4 4-4 4" />, '1.5', className, color)
}

export function CloseIcon({ size = 16, color, className }: IconProps) {
  return svg(size, <path d="M5 5l10 10M15 5L5 15" />, '1.5', className, color)
}

/** A document: the handoff packet, which is a piece of paper and not a dispatch. */
export function DocumentIcon({ size = 16, color, className }: IconProps) {
  return svg(
    size,
    <>
      <path d="M4.5 2.5h7l4 4v11h-11z" />
      <path d="M11.5 2.5v4h4" />
      <path d="M7 11h6M7 14h4" />
    </>,
    '1.5',
    className,
    color,
  )
}

export function LockIcon({ size = 16, color, className }: IconProps) {
  return svg(
    size,
    <>
      <rect x="4" y="8.5" width="12" height="8.5" rx="1.5" />
      <path d="M7 8.5V6.2a3 3 0 0 1 6 0v2.3" />
    </>,
    '1.5',
    className,
    color,
  )
}
