import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { cn } from '@/lib/cn'

/**
 * react-bits-inspired text components (DavidHDev/react-bits, MIT).
 */

/** Animate text in, split by chars or words, using GSAP. */
export function SplitText({
  text,
  className,
  as: Tag = 'span',
  splitType = 'chars',
  delay = 40,
  duration = 0.7,
  ease = 'power3.out',
  from = { opacity: 0, yPercent: 60 },
  to = { opacity: 1, yPercent: 0 },
  onComplete,
}: {
  text: string
  className?: string
  as?: ElementType
  splitType?: 'chars' | 'words'
  delay?: number
  duration?: number
  ease?: string
  from?: gsap.TweenVars
  to?: gsap.TweenVars
  onComplete?: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const tokens = splitType === 'words' ? text.split(' ') : Array.from(text)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      const items = el.querySelectorAll<HTMLElement>('[data-split]')
      gsap.fromTo(items, { ...from }, { ...to, duration, ease, stagger: delay / 1000, onComplete })
    },
    { scope: ref, dependencies: [text] },
  )

  return (
    <Tag ref={ref as never} className={className} aria-label={text}>
      {tokens.map((tok, i) => (
        <span key={i} data-split aria-hidden="true" style={{ display: 'inline-block', whiteSpace: 'pre', willChange: 'transform, opacity' }}>
          {tok}
          {splitType === 'words' && i < tokens.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
  )
}

/** Animated gradient text. */
export function GradientText({
  children,
  className,
  colors = ['#0d9488', '#14b8a6', '#0ea5e9', '#14b8a6', '#0d9488'],
  animationSpeed = 7,
}: {
  children: ReactNode
  className?: string
  colors?: string[]
  animationSpeed?: number
}) {
  return (
    <span
      className={cn('bg-clip-text text-transparent', className)}
      style={{
        backgroundImage: `linear-gradient(90deg, ${colors.join(', ')})`,
        backgroundSize: '200% 100%',
        animation: `gradient-move ${animationSpeed}s linear infinite`,
      }}
    >
      {children}
    </span>
  )
}

/** Shimmering "shiny" text sweep. */
export function ShinyText({
  text,
  className,
  speed = 4,
  base = 'var(--muted)',
  highlight = '#ffffff',
}: {
  text: string
  className?: string
  speed?: number
  base?: string
  highlight?: string
}) {
  return (
    <span
      className={cn('shiny-text font-semibold', className)}
      style={{ '--shine-speed': `${speed}s`, '--shine-base': base, '--shine-hi': highlight } as React.CSSProperties}
    >
      {text}
    </span>
  )
}

/** Count-up number that runs when it scrolls into view. */
export function CountUp({
  to,
  from = 0,
  duration = 1.6,
  className,
  prefix = '',
  suffix = '',
  separator = '',
  decimals = 0,
}: {
  to: number
  from?: number
  duration?: number
  className?: string
  prefix?: string
  suffix?: string
  separator?: string
  decimals?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [val, setVal] = useState(from)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setVal(to)
      return
    }
    let raf = 0
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        const t0 = performance.now()
        const step = (t: number) => {
          const p = Math.min(1, (t - t0) / (duration * 1000))
          const eased = 1 - Math.pow(1 - p, 3)
          setVal(from + (to - from) * eased)
          if (p < 1) raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [to, from, duration])

  const fixed = val.toFixed(decimals)
  const [int, dec] = fixed.split('.')
  const grouped = separator ? int.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : int
  const display = dec ? `${grouped}.${dec}` : grouped

  return (
    <span ref={ref} className={className}>
      {prefix}
      {display}
      {suffix}
    </span>
  )
}
