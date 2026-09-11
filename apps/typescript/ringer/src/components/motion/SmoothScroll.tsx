import { useEffect, useRef, type ReactNode } from 'react'
import { ReactLenis, useLenis, type LenisRef } from 'lenis/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

// Register GSAP plugins once for the whole app.
gsap.registerPlugin(ScrollTrigger, useGSAP)

/** Keep ScrollTrigger in sync with Lenis' interpolated scroll position. */
function ScrollTriggerSync() {
  useLenis(() => ScrollTrigger.update())
  return null
}

/**
 * App-wide smooth scrolling (Lenis) driven by the GSAP ticker so both share a
 * single RAF loop — the recommended Lenis + GSAP ScrollTrigger integration.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const lenisRef = useRef<LenisRef>(null)

  useEffect(() => {
    function update(time: number) {
      lenisRef.current?.lenis?.raf(time * 1000)
    }
    gsap.ticker.add(update)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(update)
    }
  }, [])

  return (
    <ReactLenis
      root
      ref={lenisRef}
      options={{ autoRaf: false, duration: 1.1, smoothWheel: true }}
    >
      <ScrollTriggerSync />
      {children}
    </ReactLenis>
  )
}
