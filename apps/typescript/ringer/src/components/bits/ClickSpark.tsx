import { useEffect, useRef, type ReactNode } from 'react'

interface Spark {
  x: number
  y: number
  angle: number
  start: number
}

/**
 * Global click-spark effect on a fixed, click-through canvas. Adapted from
 * react-bits (DavidHDev/react-bits, MIT). Respects prefers-reduced-motion.
 */
export function ClickSpark({
  children,
  sparkColor = '#14b8a6',
  sparkSize = 11,
  sparkRadius = 22,
  sparkCount = 8,
  duration = 420,
}: {
  children: ReactNode
  sparkColor?: string
  sparkSize?: number
  sparkRadius?: number
  sparkCount?: number
  duration?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sparks = useRef<Spark[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const onDown = (e: PointerEvent) => {
      const now = performance.now()
      for (let i = 0; i < sparkCount; i++) {
        sparks.current.push({ x: e.clientX, y: e.clientY, angle: (2 * Math.PI * i) / sparkCount, start: now })
      }
    }
    window.addEventListener('pointerdown', onDown)

    const easeOut = (t: number) => t * (2 - t)
    let raf = 0
    const draw = (now: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      sparks.current = sparks.current.filter((s) => now - s.start <= duration)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.strokeStyle = sparkColor
      for (const s of sparks.current) {
        const p = (now - s.start) / duration
        const eased = easeOut(p)
        const dist = eased * sparkRadius
        const len = sparkSize * (1 - eased)
        const cos = Math.cos(s.angle)
        const sin = Math.sin(s.angle)
        ctx.globalAlpha = 1 - eased
        ctx.beginPath()
        ctx.moveTo(s.x + cos * dist, s.y + sin * dist)
        ctx.lineTo(s.x + cos * (dist + len), s.y + sin * (dist + len))
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [sparkColor, sparkSize, sparkRadius, sparkCount, duration])

  return (
    <>
      {children}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60 }}
      />
    </>
  )
}
