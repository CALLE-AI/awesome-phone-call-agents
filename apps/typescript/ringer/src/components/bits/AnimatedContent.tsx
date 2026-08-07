import { useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger)

/**
 * Scroll-reveal wrapper. Adapted from react-bits (DavidHDev/react-bits, MIT):
 * animates its child into view on scroll using GSAP ScrollTrigger.
 */
export function AnimatedContent({
  children,
  distance = 60,
  direction = 'vertical',
  reverse = false,
  duration = 0.8,
  ease = 'power3.out',
  initialOpacity = 0,
  animateOpacity = true,
  scale = 1,
  threshold = 0.15,
  delay = 0,
  className,
}: {
  children: ReactNode
  distance?: number
  direction?: 'vertical' | 'horizontal'
  reverse?: boolean
  duration?: number
  ease?: string
  initialOpacity?: number
  animateOpacity?: boolean
  scale?: number
  threshold?: number
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      const axis = direction === 'horizontal' ? 'x' : 'y'
      const offset = reverse ? -distance : distance
      const startPct = (1 - threshold) * 100

      gsap.set(el, { [axis]: offset, scale, opacity: animateOpacity ? initialOpacity : 1 })
      gsap.to(el, {
        [axis]: 0,
        scale: 1,
        opacity: 1,
        duration,
        ease,
        delay,
        scrollTrigger: {
          trigger: el,
          start: `top ${startPct}%`,
          toggleActions: 'play none none none',
          once: true,
        },
      })
    },
    { scope: ref },
  )

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
