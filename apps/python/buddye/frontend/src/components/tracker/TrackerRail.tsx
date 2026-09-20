import { Truck, WifiOff } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'
import { Panel } from '../ui/Panel'
import { CountBadge } from '../ui/Badge'
import { UnitTracker } from './UnitTracker'
import type { Tracker } from './model'

/**
 * The column beside the map: every unit that is out, one tracker each.
 *
 * It sits next to the map rather than under it because the two are read together — the marker
 * answers *where*, the card answers *how far, how long, how fast*, and a coordinator on the phone
 * to a family needs both in one glance. Selecting a card highlights its unit and its route on the
 * map; the map does the same in reverse.
 *
 * The footer is not boilerplate. This layer is the one part of BuddyE with no real vehicle behind
 * it, and the page has to say so plainly rather than let a moving icon imply a driver. What is
 * simulated is exactly one thing — that nobody is at the wheel — and everything downstream of it,
 * the positions, the distances and the ETAs, is server state on a wall clock.
 */
/**
 * The body fills whatever height the page gives it beside the map, and is capped on a phone where
 * it is given none — a rail of eight trackers must not push the map off the top of the screen.
 */
const BODY = 'thin-scroll min-h-0 max-h-[440px] flex-1 overflow-y-auto xl:max-h-none'

export interface TrackerRailProps {
  trackers: Tracker[]
  selectedAssetId: string | null
  onSelect: (assetId: string) => void
  onOpenIncident: (incidentId: string) => void
  now: number
  offline: boolean
  className?: string
}

export function TrackerRail({ trackers, selectedAssetId, onSelect, onOpenIncident, now, offline, className }: TrackerRailProps) {
  const moving = trackers.filter((t) => t.phase === 'moving').length

  return (
    <Panel
      title="Under way"
      actions={trackers.length > 0 ? <CountBadge value={trackers.length} tone={moving > 0 ? 'accent' : 'neutral'} /> : null}
      padded={false}
      className={className}
      bodyClassName={BODY}
      footer={
        <span className="block leading-snug">
          Positions, distances and ETAs are server state advanced on a wall clock — nothing on this
          page is animated from a guess. The vehicle layer itself is <strong className="font-semibold text-text">simulated</strong>:
          the routes and the timings are real, but no driver is behind the wheel.
        </span>
      }
    >
      {offline ? (
        <div className="flex items-center gap-2 border-b border-divider bg-partial-tint px-3 py-2 text-12 text-text">
          <WifiOff size={13} className="shrink-0 text-partial" aria-hidden="true" />
          <span className="leading-snug">
            The live stream is not connected. Every unit below is frozen at its last known position.
          </span>
        </div>
      ) : null}

      {trackers.length === 0 ? (
        <EmptyState
          icon={<Truck size={22} aria-hidden="true" />}
          title="Nothing is on the road"
          body="A unit appears here the moment a deployment is committed, and moves once it rolls."
        />
      ) : (
        <div className="space-y-2 p-2">
          {trackers.map((t) => (
            <UnitTracker
              key={t.assetId}
              tracker={t}
              selected={t.assetId === selectedAssetId}
              onSelect={onSelect}
              onOpenIncident={onOpenIncident}
              now={now}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}
