/**
 * Smoothing a vehicle's motion between two positions the server actually reported.
 *
 * The simulator ticks every two seconds. Drawing each tick straight onto the map makes a van hop
 * two hundred feet at a time, which reads as a glitch rather than as driving. This hook removes the
 * hop — and it is the one place in the console where a coordinate on screen is not, instant for
 * instant, a coordinate the API sent. So the rule it holds to is narrow and absolute:
 *
 *   **It interpolates only BETWEEN two server positions. It never continues past the last one.**
 *
 * The marker is therefore always somewhere on the leg the vehicle has already driven — behind the
 * truth by up to one tick, never ahead of it. There is no velocity model, no dead reckoning and no
 * "where it probably is by now". When telemetry stops arriving the tween finishes the leg it was on
 * and the marker stops dead, which is exactly what a coordinator needs to see: a unit that has gone
 * quiet must look like a unit that has gone quiet. `Tracker.stalled` says so in words at the same
 * moment.
 *
 * Two guards make that hold in the awkward cases:
 *
 * * **A long gap snaps instead of sliding.** If more than `SNAP_AFTER_MS` passed since the last
 *   sample — a stall that recovered, a laptop lid reopened — the vehicle really did travel that leg
 *   while nobody was watching, and gliding it slowly across the gap would be a re-enactment. It
 *   jumps to where the server says it is.
 * * **The tween never outlasts the gap it is filling.** Duration is the *observed* interval between
 *   the last two samples, capped, so the marker settles on each reported position instead of
 *   permanently trailing an interval behind.
 *
 * ## Why it is imperative
 *
 * Positions change sixty times a second and the numbers beside them change once every two. If this
 * hook set React state per frame, every tick of the animation would re-render the incident list,
 * the stat tiles and every tracker widget on the page. Instead it exposes `get()` and `subscribe()`:
 * the map moves its Leaflet markers directly in the frame callback, and the widgets — which only
 * ever show server numbers — re-render when server data changes, as they should.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { StreamState } from '../../types'

/** Longest tween. Two ticks of `app/sim/movement.py::TICK_SECONDS`, in milliseconds. */
const MAX_TWEEN_MS = 2000

/** Beyond this the vehicle is placed, not driven: the intervening motion was never observed. */
const SNAP_AFTER_MS = 5000

export interface EasedSample {
  lat: number
  lon: number
  /** null when the server has not reported a bearing — the icon must then not point anywhere. */
  heading: number | null
}

export interface EasedPositions {
  /** Where to draw this unit right now. Undefined until its first server position arrives. */
  get(assetId: string): EasedSample | undefined
  /** Called on every animation frame while anything is moving, and once whenever a tick lands. */
  subscribe(listener: () => void): () => void
}

interface Track {
  from: EasedSample
  to: EasedSample
  cur: EasedSample
  /** performance.now() when this tween started. */
  start: number
  duration: number
  settled: boolean
  /** The `received_at` of the sample currently being eased towards; the change detector. */
  serverAt: number
}

/** Shortest way round the compass, so a unit turning past north does not spin the long way. */
function lerpHeading(from: number | null, to: number | null, f: number): number | null {
  if (to === null) return null
  if (from === null) return to
  const delta = ((to - from + 540) % 360) - 180
  return (from + delta * f + 360) % 360
}

export function useEasedPositions(positions: StreamState['assetPositions']): EasedPositions {
  const tracks = useRef(new Map<string, Track>())
  const listeners = useRef(new Set<() => void>())
  const frame = useRef<number | null>(null)

  const notify = useCallback(() => {
    for (const listener of listeners.current) listener()
  }, [])

  const step = useCallback(() => {
    frame.current = null
    const now = performance.now()
    let animating = false
    for (const track of tracks.current.values()) {
      if (track.settled) continue
      const f = track.duration <= 0 ? 1 : Math.min(1, (now - track.start) / track.duration)
      // Linear, not eased. A vehicle covering a straight leg at a constant speed is what the
      // simulator computed; an ease-in-out would show it slowing at every tick boundary, which is a
      // more decorative animation and a less true one.
      track.cur = {
        lat: track.from.lat + (track.to.lat - track.from.lat) * f,
        lon: track.from.lon + (track.to.lon - track.from.lon) * f,
        heading: lerpHeading(track.from.heading, track.to.heading, f),
      }
      if (f >= 1) {
        track.cur = track.to
        track.settled = true
      } else {
        animating = true
      }
    }
    notify()
    // The loop runs only while something is genuinely between two positions, so a quiet console
    // costs nothing and a stalled one stops asking for frames within a tick.
    if (animating && frame.current === null) frame.current = requestAnimationFrame(step)
  }, [notify])

  useEffect(() => {
    const now = performance.now()
    let changed = false
    const seen = new Set<string>()

    for (const [assetId, live] of Object.entries(positions)) {
      seen.add(assetId)
      const heading = typeof live.heading_deg === 'number' && Number.isFinite(live.heading_deg) ? live.heading_deg : null
      const target: EasedSample = { lat: live.lat, lon: live.lon, heading }
      const track = tracks.current.get(assetId)

      if (!track) {
        // First sighting. There is no earlier position to come from, so it is simply placed.
        tracks.current.set(assetId, {
          from: target, to: target, cur: target,
          start: now, duration: 0, settled: true, serverAt: live.received_at,
        })
        changed = true
        continue
      }
      if (track.serverAt === live.received_at) continue

      const gap = live.received_at - track.serverAt
      const duration = gap > SNAP_AFTER_MS ? 0 : Math.max(0, Math.min(gap, MAX_TWEEN_MS))
      track.from = track.cur
      track.to = target
      track.start = now
      track.duration = duration
      track.serverAt = live.received_at
      track.settled = duration <= 0
      if (track.settled) track.cur = target
      changed = true
    }

    // A unit that dropped out of the stream (a new hazard, a reset) loses its track rather than
    // freezing a marker at a position nothing is reporting any more.
    for (const assetId of [...tracks.current.keys()]) {
      if (!seen.has(assetId)) {
        tracks.current.delete(assetId)
        changed = true
      }
    }

    if (changed) {
      notify()
      if (frame.current === null) frame.current = requestAnimationFrame(step)
    }
  }, [positions, notify, step])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    },
    [],
  )

  return useMemo<EasedPositions>(
    () => ({
      get: (assetId: string) => tracks.current.get(assetId)?.cur,
      subscribe: (listener: () => void) => {
        listeners.current.add(listener)
        return () => {
          listeners.current.delete(listener)
        }
      },
    }),
    [],
  )
}
