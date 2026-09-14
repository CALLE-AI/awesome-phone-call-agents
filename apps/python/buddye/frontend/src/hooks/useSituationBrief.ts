import { useEffect, useRef, useState } from 'react'
import { fetchBrief, type SituationBrief } from '../components/case/caseApi'

/**
 * The situation brief for one person's latest finished call.
 *
 * The endpoint answers `pending` while a model is working and `ready` once it has written one, so
 * this polls — gently, and only while there is something to wait for. Polling is the right shape
 * here rather than a subscription: exactly one answer is ever expected, it is wanted within a
 * minute or two, and the page is completely usable without it.
 *
 * `stopAfterMs` exists because the free tier sometimes never answers. Giving up quietly is better
 * than a spinner that runs all evening: the case page simply keeps showing the hard data, which was
 * always the part that mattered.
 */
export function useSituationBrief(
  hazardId: string | undefined,
  neighbourId: string | undefined,
  { enabled = true, intervalMs = 6000, stopAfterMs = 180_000 }: {
    enabled?: boolean; intervalMs?: number; stopAfterMs?: number
  } = {},
) {
  const [brief, setBrief] = useState<SituationBrief | null>(null)
  const [state, setState] = useState<'idle' | 'waiting' | 'ready' | 'none'>('idle')
  const startedAt = useRef<number>(0)

  useEffect(() => {
    if (!enabled || !hazardId || !neighbourId) {
      setState('idle')
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    startedAt.current = Date.now()
    setBrief(null)
    setState('waiting')

    const tick = async () => {
      try {
        const res = await fetchBrief(hazardId, neighbourId, controller.signal)
        if (cancelled) return
        if (res.status === 'ready') {
          setBrief(res.brief)
          setState('ready')
          return // one answer is all there is; stop asking
        }
        if (res.status === 'unavailable') {
          setState('none')
          return
        }
      } catch {
        // A failed poll is not worth surfacing: the page is whole without the brief. Keep trying
        // until the deadline in case the endpoint was briefly restarting.
      }
      if (cancelled) return
      if (Date.now() - startedAt.current > stopAfterMs) {
        setState('none')
        return
      }
      timer = setTimeout(tick, intervalMs)
    }
    void tick()

    return () => {
      cancelled = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [hazardId, neighbourId, enabled, intervalMs, stopAfterMs])

  return { brief, state }
}
