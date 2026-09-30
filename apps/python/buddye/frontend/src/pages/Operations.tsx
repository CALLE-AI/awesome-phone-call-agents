import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useHazard } from '../state/hazard'
import { HazardHeader } from '../components/HazardHeader'
import { OpsMap, MapLegend } from '../components/map/OpsMap'
import { TrackerRail } from '../components/tracker/TrackerRail'
import { useTrackers } from '../components/tracker/useTrackers'
import { IncidentPanel } from '../components/IncidentPanel'
import { NeighbourPanel } from '../components/NeighbourPanel'
import { Badge, PriorityBadge } from '../components/ui/Badge'
import { buttonClass } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Panel } from '../components/ui/Panel'
import { StatCard, StatRow } from '../components/ui/StatCard'
import { buildBoard, needsYouNow } from '../lib/board'
import { incidentIsOpen, incidentOrder, isRolling, kindLabel, needsSentence } from '../lib/operator'
import { sweepIsRunning } from '../lib/status'

/**
 * Operations: watching resources move.
 *
 * This is the last screen in the flow and the only one that is not about a decision. The deciding
 * happened on Incidents; by the time a coordinator is here, a van is on a road and the question she
 * is holding is "when does somebody reach Walter?". So the page is built round the two things that
 * answer it together — the map, which says *where*, and the trackers beside it, which say *how far,
 * how long, how fast*. Selecting either highlights the other.
 *
 * Everything above the map is what would stop her watching: an agency unit prepared and unsent, and
 * the people on the block a call has flagged. Everything below it is the run of open cases, worst
 * first, for when nothing is moving yet.
 *
 * No number on this page is computed in the browser. Positions, distances, ETAs and progress are
 * server state advanced on a wall clock by `app/sim/movement.py`; the only browser-side motion is
 * the marker easing between two positions the server actually reported, which
 * `components/tracker/useEasedPositions` confines to the leg between them and never past the last.
 */
export default function Operations() {
  const { hazardId, hazard, hazards, roster, escalations, packets, incidents, assets, pending, stream, startSweep, starting, operatorName, refetch } =
    useHazard()
  const navigate = useNavigate()
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null)
  const [openNeighbourId, setOpenNeighbourId] = useState<string | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)

  const { trackers, moving, targets, eased, now, offline } = useTrackers()

  const board = useMemo(() => buildBoard(roster, stream, escalations, packets), [roster, stream, escalations, packets])
  const attention = useMemo(() => needsYouNow(board), [board])
  const callsDone = useMemo(() => Object.keys(stream.decisions).length, [stream.decisions])

  const open = useMemo(() => incidents.filter(incidentIsOpen).sort(incidentOrder), [incidents])
  /** Open incidents with nothing on the way: the addresses the evening is failing at. */
  const unserved = useMemo(() => open.filter((i) => !i.dispatches.some(isRolling) && i.awaiting_authorisation.length === 0), [open])
  const unitsOut = assets.filter((a) => a.status === 'EN_ROUTE' || a.status === 'ON_SCENE').length
  /**
   * The soonest anyone reaches anyone. The one number a coordinator on the phone is asked for.
   *
   * The whole tracker is kept, not just its ETA, because the tile prints the unit and the person
   * underneath the number. Taking the minimum from one list and the caption from the head of
   * another — `moving` is ordered by priority first — would put a P1 unit's name under a P3 unit's
   * three minutes the moment the two disagree.
   */
  const nextArrival = useMemo(
    () =>
      moving.reduce<(typeof moving)[number] | null>(
        (soonest, t) => (t.etaMinutes === null ? soonest : !soonest || t.etaMinutes < (soonest.etaMinutes ?? Infinity) ? t : soonest),
        null,
      ),
    [moving],
  )

  return (
    <>
      {/* Above even the hazard card, and on purpose. The headline is context she already has; a
          request nobody has approved is the one thing on this screen that is not moving until she
          touches it, and on a phone anything below the fold is a thing she has to go looking for. */}
      {pending.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-rejected/40 bg-rejected-tint px-4 py-3">
          <span className="text-rejected">
            <Lock size={16} aria-hidden="true" />
          </span>
          <span className="text-13 leading-snug text-text">
            <strong className="font-semibold">
              {pending.length} agency unit{pending.length === 1 ? '' : 's'} requested and waiting on you.
            </strong>{' '}
            Nothing has been sent. Only a named person can approve one.
          </span>
          <Link to={`/hazards/${hazardId}/incidents`} className={buttonClass({ variant: 'danger', size: 'sm' }, 'ml-auto')}>
            Decide now
          </Link>
        </div>
      )}

      {hazard && (
        <HazardHeader
          hazard={hazard}
          hazards={hazards}
          stream={stream}
          onSelect={(id) => navigate(`/hazards/${id}`)}
          onStart={() => void startSweep()}
          starting={starting}
          callsDone={callsDone}
        />
      )}

      {attention.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-partial/40 bg-partial-tint px-4 py-2.5">
          <span className="text-13 leading-snug text-text">
            <strong className="font-semibold">{attention.length} on this block need a human tonight</strong> — {attention
              .slice(0, 3)
              .map((p) => p.n.name)
              .join(', ')}
            {attention.length > 3 ? ` and ${attention.length - 3} more` : ''}.
          </span>
          <Link to={`/hazards/${hazardId}/sweep`} className={buttonClass({ variant: 'secondary', size: 'sm' }, 'ml-auto')}>
            Open the cases
          </Link>
        </div>
      )}

      <StatRow className="mb-3">
        <StatCard
          label="On the road"
          value={moving.length}
          unit={`of ${assets.length} units`}
          tone={moving.length > 0 ? 'accent' : 'default'}
          hint={offline ? 'The live stream is down — these are last known.' : undefined}
        />
        <StatCard
          label="Next arrival"
          value={nextArrival === null ? '—' : (nextArrival.etaMinutes ?? 0) < 1 ? '<1' : Math.round(nextArrival.etaMinutes ?? 0)}
          unit={nextArrival === null ? undefined : 'min'}
          hint={nextArrival === null ? 'Nothing is under way.' : `${nextArrival.callSign} to ${nextArrival.toName}`}
        />
        <StatCard
          label="Open cases"
          value={open.length}
          tone={unserved.length > 0 ? 'urgent' : 'default'}
          hint={unserved.length > 0 ? `${unserved.length} with nothing sent` : undefined}
          onClick={() => navigate(`/hazards/${hazardId}/incidents`)}
        />
        <StatCard
          label="On scene"
          value={unitsOut - moving.length < 0 ? 0 : unitsOut - moving.length}
          tone="good"
          hint={sweepIsRunning(stream.sweepState) ? `${callsDone} calls done so far` : 'Units that have arrived.'}
        />
      </StatRow>

      {/* Map and trackers on one row, one height, at desktop width. They are a single instrument:
          the marker answers "where", the card answers "how far and how long". */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <OpsMap
          people={board}
          incidents={incidents}
          assets={assets}
          stream={stream}
          hazard={hazard}
          trackers={trackers}
          targets={targets}
          eased={eased}
          selectedAssetId={selectedAssetId}
          onSelectAsset={(id) => setSelectedAssetId((prev) => (prev === id ? null : id))}
          selectedIncidentId={openIncidentId}
          onOpenIncident={setOpenIncidentId}
          onOpenPerson={setOpenNeighbourId}
          className="h-[380px] sm:h-[520px] xl:h-[560px]"
        />
        <TrackerRail
          trackers={trackers}
          selectedAssetId={selectedAssetId}
          onSelect={(id) => setSelectedAssetId((prev) => (prev === id ? null : id))}
          onOpenIncident={setOpenIncidentId}
          now={now}
          offline={offline}
          className="flex flex-col xl:h-[560px]"
        />
      </div>

      <MapLegend />

      <Panel
        title="Open deployment cases · worst first"
        subtitle="An address stops being here when what it needed has arrived."
        className="mt-4"
        padded={false}
      >
        {open.length === 0 ? (
          <EmptyState
            title="No open cases"
            body="A case is raised when a check-in call is understood — or when nobody answers one."
          />
        ) : (
          <div className="divide-y divide-divider">
            {open.map((i) => {
              const onTheWay = trackers.filter((t) => t.incidentId === i.id && t.phase !== 'arrived')
              const arrived = trackers.filter((t) => t.incidentId === i.id && t.phase === 'arrived')
              const waiting = i.awaiting_authorisation
              return (
                <button
                  key={i.id}
                  type="button"
                  className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-active"
                  onClick={() => setOpenIncidentId(i.id)}
                >
                  <PriorityBadge priority={i.priority} label={i.priority_label} />
                  <span className="text-13 font-medium text-text">{i.name}</span>
                  <span className="text-12 text-muted">{i.address}</span>
                  <span className="w-full text-12 sm:ml-auto sm:w-auto">
                    {waiting.length > 0 ? (
                      <Badge tone="rejected" size="sm">
                        <Lock size={10} aria-hidden="true" />
                        {kindLabel(waiting[0].kind)} requested — waiting on you
                      </Badge>
                    ) : onTheWay.length > 0 ? (
                      <span className="font-mono text-accent">
                        {onTheWay[0].callSign} · {onTheWay[0].etaMinutes === null ? 'no eta' : `${Math.round(onTheWay[0].etaMinutes)} min`} ·{' '}
                        {onTheWay[0].remainingMiles === null ? '' : `${onTheWay[0].remainingMiles.toFixed(1)} mi`}
                      </span>
                    ) : arrived.length > 0 ? (
                      <Badge tone="verified" size="sm">{arrived[0].callSign} is at the address</Badge>
                    ) : (
                      <span className="text-rejected">
                        nothing sent — needs {needsSentence(i.needs)}
                        {stream.noAssetFor[i.id] ? ` (${stream.noAssetFor[i.id]})` : ''}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </Panel>

      <p className="mt-4 px-1 pb-6 text-11 leading-snug text-faint">
        BuddyE calls neighbours and the people they nominate, and it can send community volunteers on its own. It never
        calls 911 or any agency: an ambulance, an engine or a patrol car is shown as a request until a named person
        approves it. The vehicle layer is simulated — nobody is at the wheel — but the routes, the distances and the
        arrival times are computed from real Maryvale coordinates and advanced on a wall clock, and if the backend stops,
        every unit on this map stops with it.
      </p>

      {openIncidentId && (
        <IncidentPanel
          incidentId={openIncidentId}
          operatorName={operatorName}
          onClose={() => setOpenIncidentId(null)}
          onChanged={() => void refetch()}
        />
      )}

      {openNeighbourId && hazard && (() => {
        const person = board.find((p) => p.n.id === openNeighbourId)
        return person ? (
          <NeighbourPanel
            person={person}
            hazardId={hazard.id}
            captainName={operatorName}
            escalation={person.escalation}
            onClose={() => setOpenNeighbourId(null)}
            onChanged={() => void refetch()}
          />
        ) : null
      })()}
    </>
  )
}
