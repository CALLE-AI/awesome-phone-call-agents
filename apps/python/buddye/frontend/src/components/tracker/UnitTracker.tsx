import { Crosshair, Lock, Navigation, WifiOff } from 'lucide-react'
import { Badge, PriorityBadge } from '../ui/Badge'
import { cx } from '../ui/Button'
import type { Tracker } from './model'

/**
 * One unit, under way.
 *
 * Everything on this card is a number the API sent or a word derived from one. It is laid out the
 * way it gets read: who and where first, then the bar you glance at, then the four figures you say
 * out loud on the radio — distance, ETA, speed, percent — in mono so that a 1 is as wide as an 8 and
 * the row does not twitch every two seconds as they tick.
 *
 * The two states that are easy to draw dishonestly are drawn deliberately:
 *
 * **Assigned is not moving.** A committed dispatch has a route and an ETA and nobody has pulled
 * away yet. It gets its own word, no speed and no bar animation, because a bar creeping forward
 * under an ETA is a picture of a vehicle in motion.
 *
 * **Stalled is not moving either.** When the telemetry stops the card says so, drops the speed and
 * kills the light bar, and keeps the last distance and ETA — those were true when they were sent
 * and are the right thing to act on. Nothing here estimates what has happened since.
 */

/**
 * The light bar: two lamps, alternating, exactly as a real one does.
 *
 * Only ever rendered for `Tracker.lightsOn`, which is an agency unit, EN_ROUTE, on a priority-1
 * incident, with live telemetry — the same conditions as `app/sim/movement.py::running_lights`.
 * A wellness van with a case of water is never blue-lit, and neither is an approved ambulance that
 * has not rolled.
 */
export function Beacon({ size = 5, className }: { size?: number; className?: string }) {
  const lamp = { width: size + 2, height: size }
  return (
    <span className={cx('inline-flex items-center gap-[2px]', className)} aria-label="running lights" title="Running lights — life-safety response">
      <span className="animate-beaconL rounded-[1px] bg-p1" style={lamp} />
      <span className="animate-beaconR rounded-[1px] bg-accent" style={lamp} />
    </span>
  )
}

/** A figure and its unit. Mono and tabular; `—` when there is genuinely no number to show. */
function Figure({ label, value, unit, tone = 'default' }: { label: string; value: string | null; unit?: string; tone?: 'default' | 'muted' }) {
  return (
    <div className="min-w-0">
      <div className="label truncate">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-0.5">
        <span className={cx('font-mono text-14 leading-none tabular-nums', value === null || tone === 'muted' ? 'text-faint' : 'text-text')}>
          {value ?? '—'}
        </span>
        {value !== null && unit ? <span className="text-11 text-muted">{unit}</span> : null}
      </div>
    </div>
  )
}

const PHASE_WORD: Record<Tracker['phase'], string> = {
  moving: 'On the road',
  assigned: 'Assigned — not moving yet',
  arrived: 'At the address',
}

export interface UnitTrackerProps {
  tracker: Tracker
  selected?: boolean
  onSelect?: (assetId: string) => void
  /** Opens the deployment case this unit is on. */
  onOpenIncident?: (incidentId: string) => void
  /** Ticks once a second, so "last position 14s ago" counts up without its own timer. */
  now: number
}

export function UnitTracker({ tracker: t, selected = false, onSelect, onOpenIncident, now }: UnitTrackerProps) {
  const percent = t.percentComplete === null ? null : Math.max(0, Math.min(100, t.percentComplete))
  const secondsSince = t.lastAt === null ? null : Math.max(0, Math.round((now - t.lastAt) / 1000))

  return (
    <div
      className={cx(
        'rounded border bg-surface transition-colors',
        selected ? 'border-accent shadow-activeRow' : 'border-border',
        t.stalled && 'bg-strip',
      )}
    >
      <button
        type="button"
        onClick={() => onSelect?.(t.assetId)}
        aria-pressed={selected}
        className="flex w-full items-center gap-2 px-3 pt-2.5 text-left"
        title="Show this unit on the map"
      >
        {t.lightsOn ? <Beacon /> : null}
        <span className="font-mono text-14 font-semibold leading-none text-text">{t.callSign}</span>
        <span className="truncate text-12 text-muted">{t.kindLabel}</span>
        {t.agency ? (
          <span className="flex shrink-0 items-center gap-1 text-11 text-rejected" title="Agency unit — a named person approved this">
            <Lock size={10} aria-hidden="true" />
            approved
          </span>
        ) : null}
        <span className="ml-auto shrink-0">
          {t.priority !== null ? <PriorityBadge priority={t.priority} /> : null}
        </span>
      </button>

      <div className="px-3 pb-2.5 pt-1.5">
        <div className="flex items-baseline gap-1.5 text-12">
          <Crosshair size={11} className="shrink-0 translate-y-px text-faint" aria-hidden="true" />
          {t.incidentId && onOpenIncident ? (
            <button
              type="button"
              onClick={() => onOpenIncident(t.incidentId as string)}
              className="truncate text-left font-medium text-text underline decoration-edge underline-offset-2 hover:decoration-accent"
            >
              {t.toName}
            </button>
          ) : (
            <span className="truncate font-medium text-text">{t.toName}</span>
          )}
          <span className="truncate text-muted">{t.toAddress}</span>
        </div>

        {/* The bar. Its width transitions between two server values over roughly one tick and then
            stops — the same discipline as the map marker: it moves between reported positions and
            never past the last one. A stalled unit loses the transition and simply holds. */}
        <div className="mt-2 h-[6px] w-full overflow-hidden rounded-[2px] bg-ground" role="progressbar" aria-valuenow={percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={cx(
              'h-full rounded-[2px]',
              t.stalled ? 'bg-faint' : t.phase === 'arrived' ? 'bg-verified' : t.agency ? 'bg-p1' : 'bg-accent',
              !t.stalled && t.phase === 'moving' && 'transition-[width] duration-[1900ms] ease-linear',
            )}
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>

        <div className="mt-2 grid grid-cols-4 gap-2">
          <Figure label="to go" value={t.remainingMiles === null ? null : t.remainingMiles.toFixed(1)} unit="mi" />
          <Figure label="eta" value={t.etaMinutes === null ? null : (t.etaMinutes < 1 ? '<1' : String(Math.round(t.etaMinutes)))} unit="min" />
          <Figure label="speed" value={t.speedMph === null ? null : t.speedMph.toFixed(0)} unit="mph" />
          <Figure label="done" value={percent === null ? null : percent.toFixed(0)} unit="%" />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-11">
          {t.stalled ? (
            <Badge tone="partial" size="sm">
              <WifiOff size={10} aria-hidden="true" />
              telemetry stalled
            </Badge>
          ) : t.phase === 'moving' ? (
            <Badge tone="accent" size="sm" dot pulse>
              {PHASE_WORD.moving}
            </Badge>
          ) : t.phase === 'arrived' ? (
            <Badge tone="verified" size="sm">
              {PHASE_WORD.arrived}
            </Badge>
          ) : (
            <Badge tone="neutral" size="sm">
              {PHASE_WORD.assigned}
            </Badge>
          )}

          {/* Heading only when the server gave one. No bearing means the icon does not point and
              this does not claim a direction. */}
          {!t.stalled && t.phase === 'moving' && t.compass ? (
            <span className="flex items-center gap-1 text-muted">
              <Navigation size={10} className="shrink-0" style={{ transform: `rotate(${t.headingDeg ?? 0}deg)` }} aria-hidden="true" />
              heading {t.compass}
            </span>
          ) : null}

          {/* "live" is claimed only while the unit is actually reporting. A parked or arrived unit
              still shows a server position — it just is not a stream of them any more. */}
          <span className="ml-auto font-mono text-faint">
            {t.stalled
              ? secondsSince === null
                ? 'no live telemetry'
                : `last position ${secondsSince < 90 ? `${secondsSince}s` : `${Math.round(secondsSince / 60)} min`} ago`
              : t.phase === 'moving' && t.live
                ? 'server position, live'
                : t.live
                  ? 'server position'
                  : 'position from the last fetch'}
          </span>
        </div>
      </div>
    </div>
  )
}
