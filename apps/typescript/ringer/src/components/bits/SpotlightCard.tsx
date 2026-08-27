import { useRef, type ElementType, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Card with a cursor-following spotlight glow. Adapted from react-bits
 * (DavidHDev/react-bits, MIT).
 */
export function SpotlightCard({
  children,
  className,
  spotlightColor = 'color-mix(in srgb, var(--primary) 28%, transparent)',
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode
  className?: string
  spotlightColor?: string
  as?: ElementType
  [key: string]: unknown
}) {
  const ref = useRef<HTMLElement>(null)

  const onMouseMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }

  return (
    <Tag
      ref={ref as never}
      onMouseMove={onMouseMove}
      className={cn('spotlight-card', className)}
      style={{ '--spot': spotlightColor } as React.CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  )
}
