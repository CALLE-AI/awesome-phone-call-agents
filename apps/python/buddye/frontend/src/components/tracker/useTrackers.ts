/**
 * The console's live view of everything that is out, in one hook.
 *
 * Operations and Fleet both need the same answer to "what is moving, where is it, and how do we
 * know" — so they ask the same function rather than each assembling it from `stream.assetPositions`
 * and hoping they agree. Nothing here fetches: the layout owns the one SSE connection and the one
 * set of REST rows, and this is a derivation of them.
 */
import { useMemo } from 'react'
import { useHazard } from '../../state/hazard'
import { useNow } from '../../hooks/useNow'
import { buildTrackers, targetsOf } from './model'
import type { Tracker, TrackerTarget } from './model'
import { useEasedPositions } from './useEasedPositions'
import type { EasedPositions } from './useEasedPositions'

export interface LiveFleet {
  /** Every unit assigned, moving or on scene — worst incident first, then soonest arrival. */
  trackers: Tracker[]
  /** Only the ones actually under way. The number the page leads with. */
  moving: Tracker[]
  /** The addresses being driven to, one per deployment case, for the map's target markers. */
  targets: TrackerTarget[]
  /** Where to draw each unit this frame. Read imperatively by the map; never by a widget. */
  eased: EasedPositions
  /** A once-a-second clock, so "last position 14s ago" counts up without a timer per card. */
  now: number
  /** True while the SSE connection is not open — every tracker is stalled and says so. */
  offline: boolean
}

export function useTrackers(): LiveFleet {
  const { assets, incidents, stream } = useHazard()

  // The clock only runs when there is something out to be stale about. An idle console does not
  // need to re-render once a second.
  const anythingOut = assets.some((a) => a.destination !== null)
  const now = useNow(anythingOut)

  // When the rows currently on screen were fetched. A tracker with no live telemetry at all — a
  // page reloaded mid-run — is judged stale against this rather than against a server timestamp,
  // which would be measured on a different clock from the browser's.
  const fetchedAt = useMemo(() => Date.now(), [assets])

  const eased = useEasedPositions(stream.assetPositions)
  const connected = stream.connection === 'open'

  const trackers = useMemo(
    () =>
      buildTrackers({
        assets,
        incidents,
        positions: stream.assetPositions,
        routes: stream.routes,
        connected,
        now,
        fetchedAt,
      }),
    [assets, incidents, stream.assetPositions, stream.routes, connected, now, fetchedAt],
  )

  const moving = useMemo(() => trackers.filter((t) => t.phase === 'moving'), [trackers])
  const targets = useMemo(() => targetsOf(trackers), [trackers])

  return { trackers, moving, targets, eased, now, offline: !connected }
}
