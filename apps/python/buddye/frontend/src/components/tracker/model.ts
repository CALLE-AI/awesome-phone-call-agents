/**
 * One row per unit that is out, assembled from server rows and nothing else.
 *
 * This is the single place the console decides what "a unit under way" is and what its numbers are,
 * so the map, the tracker widgets and the fleet board cannot come to different conclusions about
 * the same van.
 *
 * ## Where every number comes from
 *
 * | shown            | source                                                                  |
 * |------------------|-------------------------------------------------------------------------|
 * | position         | `asset.moved` (`AssetLive`), falling back to the asset row's `lat/lon`   |
 * | heading          | the same event — the bearing of the polyline segment being driven        |
 * | distance left    | `remaining_miles`, computed by `app/sim/movement.py` from the route      |
 * | ETA              | `eta_minutes`, that distance over the unit's own road speed              |
 * | percent complete | `Dispatch.progress`, persisted server state                             |
 * | speed            | `Asset.speed_mph`, the exact number the ETA was divided by               |
 *
 * Two of those are re-derivations rather than fields, because the SSE reducer in
 * `hooks/useEventStream.ts` does not carry them onto `AssetLive` and that file belongs to another
 * part of the console:
 *
 * **Speed** is read off the asset row. The backend's change record sets
 * `speed_mph = round(float(asset.speed_mph), 1)` — literally this row's value — so reading it here
 * cannot disagree with the ETA that was computed from it. It is shown only while the unit is
 * actually moving and its telemetry is fresh: a parked van's row still says 24 mph, and printing
 * that beside a stationary vehicle would be the one kind of number this console does not print.
 *
 * **The light bar** is re-derived from the same three facts `app/sim/movement.py::running_lights`
 * uses — the unit is an agency unit (`requires_authorisation`, stamped by
 * `app/domain/state.py::requires_authorisation`, the single source of truth), it is EN_ROUTE, and
 * the incident it is going to is priority 1. All three are fields on rows the API sent. A community
 * van is never lit, and neither is an agency unit a human approved but that has not rolled.
 *
 * ## Staleness
 *
 * The whole claim of the vehicle layer is that it stops when the server stops. `stalled` is how a
 * widget knows to say so: either the SSE connection is not open, or the last telemetry for this
 * unit is older than `STALE_AFTER_MS`. A stalled tracker shows its last known distance and ETA —
 * those were true when they were sent — but drops speed, drops the light bar and says out loud that
 * the numbers have stopped arriving. Nothing extrapolates.
 */
import type { Asset, AssetLive, IncidentRow, LatLon, StreamState } from '../../types'
import { isAgency, kindLabel } from '../../lib/operator'

/**
 * How long a unit may go without telemetry before the console stops calling it live.
 *
 * `app/sim/movement.py::TICK_SECONDS` is 2, so this is three and a half missed ticks: long enough
 * that a slow tick or a garbage-collection pause does not flicker the word "stalled" onto a healthy
 * screen, short enough that a dead stream is admitted within a few seconds.
 */
export const STALE_AFTER_MS = 7000

/** Priority 1 is life safety, and the only priority an agency unit runs its light bar on. */
export const LIGHTS_PRIORITY = 1

/**
 * Sixteen points, the same table as `app/sim/movement.py::COMPASS`. A heading reads as a word so a
 * tired person does not have to convert three digits in their head.
 */
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** The heading as a compass word, or '' when the server has not given one. Never a guessed 'N'. */
export function compassPoint(heading: number | null): string {
  if (heading === null || !Number.isFinite(heading)) return ''
  return COMPASS[Math.floor((((heading % 360) + 360) % 360) / 22.5 + 0.5) % 16]
}

/** Where a unit is in its journey. `assigned` has a route and an ETA and is not moving yet. */
export type TrackerPhase = 'moving' | 'assigned' | 'arrived'

export interface Tracker {
  assetId: string
  callSign: string
  kind: string
  kindLabel: string
  operatorName: string
  /** True for EMS, fire and police: only a named human can send one. */
  agency: boolean
  phase: TrackerPhase
  incidentId: string | null
  /** Who it is going to — the person's name when we hold the incident row, else the address. */
  toName: string
  toAddress: string
  toLat: number | null
  toLon: number | null
  priority: number | null
  priorityLabel: string
  /** The polyline the ETA was measured along, exactly as the server computed it. */
  route: LatLon[]
  lat: number
  lon: number
  /** null when the server has not reported a bearing. The icon then does not point anywhere. */
  headingDeg: number | null
  compass: string
  remainingMiles: number | null
  etaMinutes: number | null
  percentComplete: number | null
  /** Only while moving and fresh; null otherwise, because a parked unit has no speed. */
  speedMph: number | null
  lightsOn: boolean
  stalled: boolean
  /** ms on the browser clock when this unit's last telemetry landed; null if only a fetch. */
  lastAt: number | null
  /** True when the position came off the live stream rather than the last REST fetch. */
  live: boolean
}

export interface BuildTrackersInput {
  assets: Asset[]
  incidents: IncidentRow[]
  positions: StreamState['assetPositions']
  routes: StreamState['routes']
  /** Is the SSE connection open? A closed stream stalls every tracker, whatever their timestamps. */
  connected: boolean
  now: number
  /** Browser clock when the REST rows currently on screen were fetched. */
  fetchedAt: number
}

/** `Asset.heading_deg` is typed as a number but arrives null for a unit that has never moved. */
function headingOf(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function phaseOf(dispatchStatus: string, assetStatus: string): TrackerPhase | null {
  if (dispatchStatus === 'EN_ROUTE' || assetStatus === 'EN_ROUTE') return 'moving'
  if (dispatchStatus === 'ARRIVED' || assetStatus === 'ON_SCENE') return 'arrived'
  if (dispatchStatus === 'COMMITTED' || assetStatus === 'ASSIGNED') return 'assigned'
  return null
}

/**
 * Every unit that is out, worst incident first and then soonest arrival.
 *
 * Deliberately built from the REST rows first and only then overlaid with the stream: a coordinator
 * who reloads the page mid-run has an empty `positions` map for a few seconds, and `Asset.destination`
 * already carries a complete journey — progress, distance, ETA and the route. Driving off the stream
 * alone would show her an empty rail while four vans were on the road.
 */
export function buildTrackers({ assets, incidents, positions, routes, connected, now, fetchedAt }: BuildTrackersInput): Tracker[] {
  const incidentById = new Map(incidents.map((i) => [i.id, i]))
  const out: Tracker[] = []

  for (const asset of assets) {
    const dest = asset.destination
    if (!dest) continue
    const phase = phaseOf(String(dest.status), String(asset.status))
    if (phase === null) continue

    const incident = incidentById.get(dest.incident_id) ?? null
    // The live sample only speaks for this journey if it is the one it was emitted for. After a
    // reassignment the previous incident's telemetry is about a trip that no longer exists.
    const liveRaw: AssetLive | undefined = positions[asset.id]
    const live = liveRaw && (liveRaw.incident_id === null || liveRaw.incident_id === dest.incident_id) ? liveRaw : undefined

    const lastAt = live ? live.received_at : null
    // Staleness is only a fault for a unit that is *supposed* to be reporting. `movement.py::tick`
    // selects EN_ROUTE dispatches only, so a van that reached Rosa stops emitting the moment it
    // arrives, and a committed unit that has not pulled away has never emitted at all. Judging
    // those by the clock would put "telemetry stalled" on a journey that finished perfectly, for
    // the rest of the evening — a fault light for a success, which is its own kind of lie.
    const silent = lastAt !== null ? now - lastAt > STALE_AFTER_MS : now - fetchedAt > STALE_AFTER_MS
    const stalled = phase === 'moving' && (!connected || silent)

    // The route: the destination's own copy first (it is the dispatch row the ETA came from), then
    // whatever the stream captured for a dispatch REST has not caught up with.
    const streamRoute = live?.dispatch_id ? routes[live.dispatch_id]?.route : undefined
    const route = (dest.route?.length ?? 0) >= 2 ? dest.route : streamRoute ?? []

    const progress = live?.progress ?? dest.progress ?? null
    const agency = isAgency(asset)
    const priority = incident ? Number(incident.priority ?? 5) : null

    out.push({
      assetId: asset.id,
      callSign: asset.call_sign,
      kind: String(asset.kind),
      kindLabel: kindLabel(asset.kind),
      operatorName: asset.operator_name,
      agency,
      phase,
      incidentId: dest.incident_id,
      toName: incident?.name || dest.address,
      toAddress: incident?.address || dest.address,
      toLat: dest.lat ?? incident?.lat ?? null,
      toLon: dest.lon ?? incident?.lon ?? null,
      priority,
      priorityLabel: incident?.priority_label ?? '',
      route,
      lat: live ? live.lat : asset.lat,
      lon: live ? live.lon : asset.lon,
      headingDeg: live ? headingOf(live.heading_deg) : headingOf(asset.heading_deg),
      compass: compassPoint(live ? headingOf(live.heading_deg) : headingOf(asset.heading_deg)),
      remainingMiles: live?.remaining_miles ?? dest.remaining_miles ?? null,
      etaMinutes: live?.eta_minutes ?? dest.eta_minutes ?? null,
      percentComplete: progress === null ? null : progress * 100,
      // Speed is a fact about a unit in motion. Stationary or stalled, there is no number to show.
      speedMph: phase === 'moving' && !stalled ? Number(asset.speed_mph ?? 0) || null : null,
      lightsOn: agency && phase === 'moving' && !stalled && priority !== null && priority <= LIGHTS_PRIORITY,
      stalled,
      lastAt,
      live: !!live,
    })
  }

  const PHASE_RANK: Record<TrackerPhase, number> = { moving: 0, assigned: 1, arrived: 2 }
  return out.sort((a, b) => {
    const byPhase = PHASE_RANK[a.phase] - PHASE_RANK[b.phase]
    if (byPhase !== 0) return byPhase
    const byPriority = (a.priority ?? 5) - (b.priority ?? 5)
    if (byPriority !== 0) return byPriority
    // Soonest arrival next. A unit with no ETA (a stopped vehicle) sinks rather than sorting first.
    const ae = a.etaMinutes ?? Number.POSITIVE_INFINITY
    const be = b.etaMinutes ?? Number.POSITIVE_INFINITY
    if (ae !== be) return ae - be
    return a.callSign.localeCompare(b.callSign)
  })
}

/** The destinations currently being driven to, one per address, for the map's target markers. */
export interface TrackerTarget {
  incidentId: string
  name: string
  address: string
  lat: number
  lon: number
  priority: number | null
  callSigns: string[]
  /** True while at least one unit is still on the road to it. */
  inbound: boolean
}

export function targetsOf(trackers: Tracker[]): TrackerTarget[] {
  const byIncident = new Map<string, TrackerTarget>()
  for (const t of trackers) {
    if (!t.incidentId || t.toLat === null || t.toLon === null) continue
    const existing = byIncident.get(t.incidentId)
    if (existing) {
      existing.callSigns.push(t.callSign)
      existing.inbound = existing.inbound || t.phase !== 'arrived'
      continue
    }
    byIncident.set(t.incidentId, {
      incidentId: t.incidentId,
      name: t.toName,
      address: t.toAddress,
      lat: t.toLat,
      lon: t.toLon,
      priority: t.priority,
      callSigns: [t.callSign],
      inbound: t.phase !== 'arrived',
    })
  }
  return [...byIncident.values()]
}
