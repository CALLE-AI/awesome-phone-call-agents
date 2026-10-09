import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useHazard } from '../state/hazard'
import { IncidentPanel } from '../components/IncidentPanel'
import { Badge } from '../components/ui/Badge'
import type { BadgeTone } from '../components/ui/Badge'
import { buttonClass, cx } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Panel } from '../components/ui/Panel'
import { StatCard, StatRow } from '../components/ui/StatCard'
import { TBody, THead, Table, TableWrap, Td, Th, Tr, useSort } from '../components/ui/Table'
import { Beacon } from '../components/tracker/UnitTracker'
import { useTrackers } from '../components/tracker/useTrackers'
import type { Tracker } from '../components/tracker/model'
import { assetStatusLabel, assetStatusTone, isAgency, kindLabel, needLabel, stalenessText } from '../lib/operator'
import type { Asset } from '../types'

/**
 * The asset board: every unit, what it can do, where it is and what it is on.
 *
 * Three honesty notes are built into this page rather than left to a reader's assumption.
 *
 * **Agency units are on the board.** Leaving an ambulance off would have hidden the authorisation
 * rule instead of enforcing it — a coordinator who never sees one learns nothing about who is
 * allowed to spend one. They are here, they can be proposed and routed, and they are marked.
 *
 * **There is no send button anywhere on this page, and the page says why.** For a community van it
 * is because an agent commits it without asking. For an ambulance it is because the only door is a
 * named human approving a deployment case, and putting a dispatch control on an asset board would
 * be a second door. `app/domain/state.py::requires_authorisation` decides which a unit is; this
 * screen only reports it.
 *
 * **Positions are as fresh as the server's last tick.** The stream that moves them is scoped to the
 * hazard on screen, so a unit working a different hazard shows the position its last fetch carried.
 * Every row says which it is looking at rather than letting a stale dot look live.
 */

type Key = 'call_sign' | 'kind' | 'status' | 'spare' | 'speed'

/**
 * `lib/operator` speaks the older `Pill` vocabulary and the primitives speak `Badge`'s. The two
 * scales mean the same things except that Pill's neutral is called `grey`, so this is the whole
 * translation — kept as a function rather than inlined so the status colours cannot drift apart
 * between the two families as either grows.
 */
function badgeTone(tone: string): BadgeTone {
  return tone === 'grey' ? 'neutral' : (tone as BadgeTone)
}

export default function Fleet() {
  const { hazardId, assets, incidents, stream, operatorName, refetch } = useHazard()
  const navigate = useNavigate()
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null)
  const { trackers, now } = useTrackers()
  const sort = useSort<Key>('call_sign')

  const incidentById = useMemo(() => new Map(incidents.map((i) => [i.id, i])), [incidents])
  const trackerByAsset = useMemo(() => new Map(trackers.map((t) => [t.assetId, t])), [trackers])
  /** Units an agent has prepared and nobody has approved: requested, not assigned. */
  const requestedByAsset = useMemo(() => {
    const m = new Map<string, { incidentId: string; kind: string }>()
    for (const i of incidents) for (const d of i.awaiting_authorisation) m.set(d.asset_id, { incidentId: d.incident_id, kind: String(d.kind) })
    return m
  }, [incidents])

  const community = useMemo(() => assets.filter((a) => !isAgency(a)), [assets])
  const agency = useMemo(() => assets.filter((a) => isAgency(a)), [assets])
  const available = assets.filter((a) => a.status === 'AVAILABLE').length
  const out = assets.filter((a) => a.status === 'EN_ROUTE' || a.status === 'ON_SCENE').length

  const value = (a: Asset, key: Key): string | number =>
    key === 'call_sign' ? a.call_sign
      : key === 'kind' ? kindLabel(a.kind)
        : key === 'status' ? assetStatusLabel(a.status)
          : key === 'spare' ? a.spare_capacity
            : Number(a.speed_mph ?? 0)

  const header = (
    <THead>
      <Tr>
        <Th sortable sortDirection={sort.directionFor('call_sign')} onSort={() => sort.toggle('call_sign')}>Unit</Th>
        <Th sortable sortDirection={sort.directionFor('kind')} onSort={() => sort.toggle('kind')}>Kind</Th>
        <Th>Crew</Th>
        <Th sortable sortDirection={sort.directionFor('status')} onSort={() => sort.toggle('status')}>Status</Th>
        <Th>Can do</Th>
        <Th numeric sortable sortDirection={sort.directionFor('spare')} onSort={() => sort.toggle('spare')}>Stops left</Th>
        <Th numeric sortable sortDirection={sort.directionFor('speed')} onSort={() => sort.toggle('speed')}>Road speed</Th>
        <Th>Assignment</Th>
        <Th>Position</Th>
      </Tr>
    </THead>
  )

  /**
   * What this unit is on, in the words the rest of the console uses for the same thing.
   *
   * A unit can be two things at once, and both have to be said: an ambulance parked at one address
   * can already have been *requested* for a second one. What it is actually doing comes first —
   * that is where the vehicle is and what it is committed to — and the outstanding request follows
   * it, still marked as unsent, rather than replacing it. Showing only the request would put a
   * unit's current job behind a proposal nobody has approved.
   */
  const assignment = (a: Asset, tracker: Tracker | undefined) => {
    const requested = requestedByAsset.get(a.id)
    if (!tracker && !requested) return <span className="text-12 text-faint">—</span>
    return (
      <span className="block">
        {tracker ? (
          <button
            type="button"
            onClick={() => tracker.incidentId && setOpenIncidentId(tracker.incidentId)}
            className="block text-left text-12 leading-snug"
          >
            <span className="flex items-center gap-1.5">
              {tracker.lightsOn ? <Beacon size={4} /> : null}
              <span className="font-medium text-text">{tracker.toName}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              {tracker.phase === 'arrived' ? (
                <Badge tone="verified" size="sm">at the address</Badge>
              ) : tracker.phase === 'assigned' ? (
                <Badge tone="neutral" size="sm">not moving yet</Badge>
              ) : tracker.stalled ? (
                <Badge tone="partial" size="sm">telemetry stalled</Badge>
              ) : (
                <span className="font-mono text-11 tabular-nums text-accent">
                  {tracker.etaMinutes === null ? 'no eta' : `${Math.round(tracker.etaMinutes)} min`}
                  {tracker.remainingMiles === null ? '' : ` · ${tracker.remainingMiles.toFixed(1)} mi`}
                  {tracker.percentComplete === null ? '' : ` · ${tracker.percentComplete.toFixed(0)}%`}
                </span>
              )}
            </span>
          </button>
        ) : null}
        {requested ? (
          <button
            type="button"
            onClick={() => setOpenIncidentId(requested.incidentId)}
            className={cx('block text-left text-12 leading-snug text-rejected', tracker && 'mt-1.5 border-t border-divider pt-1.5')}
          >
            <span className="font-medium">
              {tracker ? 'Also requested' : 'Requested'} for {incidentById.get(requested.incidentId)?.name ?? 'a case'}
            </span>
            <span className="block text-11">Waiting on a named person. Nothing has been sent and this unit has not been asked.</span>
          </button>
        ) : null}
      </span>
    )
  }

  /** Where it is, and how sure we are of that. Never a coordinate without its provenance. */
  const position = (a: Asset, tracker: Tracker | undefined) => {
    const live = stream.assetPositions[a.id]
    const lat = tracker ? tracker.lat : live?.lat ?? a.lat
    const lon = tracker ? tracker.lon : live?.lon ?? a.lon
    const provenance = tracker?.stalled
      ? 'stalled — last known'
      : live
        ? stalenessText(live, now) || 'live, this second'
        : 'from the last fetch'
    return (
      <span className="block">
        <span className="block whitespace-nowrap font-mono text-11 tabular-nums text-muted">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </span>
        <span className={cx('block text-11', tracker?.stalled ? 'text-partial' : 'text-faint')}>{provenance}</span>
      </span>
    )
  }

  const rows = (list: Asset[]) => (
    <TableWrap>
      <Table>
        {header}
        <TBody>
          {sort.sorted(list, value).map((a) => {
            const tracker = trackerByAsset.get(a.id)
            return (
              <Tr key={a.id}>
                <Td>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-13 font-semibold text-text">{a.call_sign}</span>
                    {isAgency(a) ? <Lock size={11} className="shrink-0 text-rejected" aria-label="requires a named human" /> : null}
                  </span>
                </Td>
                <Td>{kindLabel(a.kind)}</Td>
                <Td muted>{a.operator_name}</Td>
                <Td>
                  <Badge tone={badgeTone(assetStatusTone(a.status))} size="sm">
                    {assetStatusLabel(a.status)}
                  </Badge>
                </Td>
                <Td muted className="max-w-[220px] text-12">
                  {a.capabilities.map(needLabel).join(', ') || 'nothing recorded'}
                </Td>
                <Td numeric mono>
                  {a.spare_capacity}/{a.capacity}
                </Td>
                <Td numeric mono>{Number(a.speed_mph ?? 0).toFixed(0)}</Td>
                <Td className="min-w-[190px]">{assignment(a, tracker)}</Td>
                <Td className="min-w-[150px]">{position(a, tracker)}</Td>
              </Tr>
            )
          })}
        </TBody>
      </Table>
    </TableWrap>
  )

  return (
    <>
      <p className="mb-3 max-w-[86ch] text-13 leading-snug text-muted">
        {community.length} community units an agent may commit on its own, {agency.length} agency units it may only ask
        for. Road speed is the number every ETA on the console is divided by. Positions are server state advanced on a
        wall clock — nothing here is animated in your browser, and the vehicle layer is simulated: real routes and real
        timings, no driver.
      </p>

      <StatRow className="mb-4">
        <StatCard label="Units on the board" value={assets.length} hint={`${community.length} community, ${agency.length} agency`} />
        <StatCard label="Available" value={available} tone={available === 0 ? 'urgent' : 'good'} hint="Free to take a case now." />
        <StatCard label="Out" value={out} tone={out > 0 ? 'accent' : 'default'} hint="On the road or at an address." />
        <StatCard
          label="Need a human"
          value={requestedByAsset.size}
          tone={requestedByAsset.size > 0 ? 'urgent' : 'default'}
          hint={requestedByAsset.size > 0 ? 'Prepared and unsent, waiting on an approval.' : 'Nothing is waiting on an approval.'}
          onClick={requestedByAsset.size > 0 ? () => navigate(`/hazards/${hazardId}/incidents`) : undefined}
        />
      </StatRow>

      <Panel
        title="Community · an agent may commit these"
        subtitle="No send button here, and none is needed: a wellness van with a case of water is a recoverable mistake, and waiting for a click costs more than it saves."
        padded={false}
        className="mb-4"
      >
        {community.length === 0 ? <EmptyState title="No community units" body="Nothing is staged for this block." /> : rows(community)}
      </Panel>

      <Panel
        title="Agency · a named person must approve every one"
        subtitle="Prepared, routed and held. BuddyE never dials 911 or any agency itself."
        padded={false}
        className="mb-6 border-l-[3px] border-l-rejected"
        footer={
          <span className="flex flex-wrap items-center gap-2 leading-snug">
            <Lock size={12} className="shrink-0 text-rejected" aria-hidden="true" />
            <span className="min-w-0">
              There is no control on this page that can send one of these. An agency unit leaves its station only when a
              named person approves the deployment case it was prepared for.
            </span>
            <Link to={`/hazards/${hazardId}/incidents`} className={buttonClass({ variant: 'secondary', size: 'sm' }, 'ml-auto')}>
              Deployment cases
            </Link>
          </span>
        }
      >
        {agency.length === 0 ? <EmptyState title="No agency units" body="None are configured for this area." /> : rows(agency)}
      </Panel>

      {openIncidentId && (
        <IncidentPanel
          incidentId={openIncidentId}
          operatorName={operatorName}
          onClose={() => setOpenIncidentId(null)}
          onChanged={() => void refetch()}
        />
      )}
    </>
  )
}
