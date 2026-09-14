import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Magnetic hover wrapper — the child is gently pulled toward the cursor.
 * Adapted from react-bits (DavidHDev/react-bits, MIT).
 */
export function Magnet({
  children,
  strength = 4,
  className,
  disabled = false,
}: {
  children: ReactNode
  /** Higher = weaker pull (divisor). */
  strength?: number
  className?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const onMove = (e: React.MouseEvent) => {
    if (disabled) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    setPos({ x: (e.clientX - cx) / strength, y: (e.clientY - cy) / strength })
  }

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => setPos({ x: 0, y: 0 })}
      className={cn('inline-block', className)}
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px)`,
        transition: 'transform 0.25s cubic-bezier(0.22,1,0.36,1)',
        willChange: 'transform',
      }}
    >
      {children}
    </div>
  )
}
