/**
 * How the operator layer is worded and coloured, and the two orderings the console argues from.
 *
 * The same discipline as `lib/status.ts`: the screen never shows a coordinator a raw enum. An
 * `EMS_UNIT` is "Ambulance", a `POLICE_WELFARE` is "Police welfare check", a `water` need is
 * "drinking water". And a PROPOSED agency dispatch is called a **request** everywhere, in every
 * view, because that is what it is — an agent has prepared it and nobody has been asked.
 */
import type { PillTone } from '../components/Pill'
import type {
  Asset,
  AssetKind,
  AssetLive,
  DispatchRow,
  DispatchStatus,
  IncidentRow,
  IncidentStatus,
} from '../types'

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
const KIND_META: Record<AssetKind, { label: string; short: string; agency: boolean }> = {
  WELLNESS_VAN: { label: 'Wellness van', short: 'Van', agency: false },
  VOLUNTEER_DRIVER: { label: 'Volunteer driver', short: 'Ride', agency: false },
  WATER_ICE_TRUCK: { label: 'Water and ice truck', short: 'Water', agency: false },
  COOLING_SHUTTLE: { label: 'Cooling shuttle', short: 'Shuttle', agency: false },
  POWER_CART: { label: 'Power cart', short: 'Power', agency: false },
  NURSE_OUTREACH: { label: 'Outreach nurse', short: 'Nurse', agency: false },
  EMS_UNIT: { label: 'Ambulance', short: 'EMS', agency: true },
  FIRE_UNIT: { label: 'Fire engine', short: 'Fire', agency: true },
  POLICE_WELFARE: { label: 'Police welfare check', short: 'Police', agency: true },
}

export function kindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Unit'
  return KIND_META[kind as AssetKind]?.label ?? String(kind).replace(/_/g, ' ').toLowerCase()
}

export function kindShort(kind: string | null | undefined): string {
  if (!kind) return 'Unit'
  return KIND_META[kind as AssetKind]?.short ?? String(kind).slice(0, 5)
}

/**
 * Is this an agency resource — one a named human has to approve?
 *
 * Read off the row whenever the row says so: `requires_authorisation` is stamped by
 * `app.domain.state.requires_authorisation`, which is the single source of truth. The kind table is
 * only the fallback for payloads that do not carry the flag, and it errs towards "yes".
 */
export function isAgency(row: { kind?: string | null; requires_authorisation?: boolean }): boolean {
  if (typeof row.requires_authorisation === 'boolean') return row.requires_authorisation
  const meta = KIND_META[row.kind as AssetKind]
  return meta ? meta.agency : true
}

const ASSET_STATUS_META: Record<string, { label: string; tone: PillTone }> = {
  AVAILABLE: { label: 'Available', tone: 'verified' },
  ASSIGNED: { label: 'Assigned', tone: 'accent' },
  EN_ROUTE: { label: 'On the road', tone: 'accent' },
  ON_SCENE: { label: 'At the address', tone: 'partial' },
  OUT_OF_SERVICE: { label: 'Out of service', tone: 'grey' },
}

export function assetStatusLabel(status: string | null | undefined): string {
  return ASSET_STATUS_META[String(status ?? '')]?.label ?? String(status ?? 'unknown')
}

export function assetStatusTone(status: string | null | undefined): PillTone {
  return ASSET_STATUS_META[String(status ?? '')]?.tone ?? 'grey'
}

/**
 * Where to draw an asset: the live position if the stream has moved it, otherwise the position the
 * REST payload was fetched with.
 *
 * Never a guess and never an interpolation. Both numbers are server state advanced on a wall
 * clock — if the backend stops, this stops returning new values and the vehicle stops.
 */
export function assetPosition(asset: Asset, live: AssetLive | undefined): { lat: number; lon: number; heading: number } {
  if (live) return { lat: live.lat, lon: live.lon, heading: live.heading_deg }
  return { lat: asset.lat, lon: asset.lon, heading: asset.heading_deg }
}

// ---------------------------------------------------------------------------
// Dispatches
// ---------------------------------------------------------------------------
const DISPATCH_META: Record<DispatchStatus, { label: string; agencyLabel: string; tone: PillTone }> = {
  // "Requested" is wrong for a PROPOSED agency unit and the distinction is the safety property:
  // nobody has been asked. Community units get the milder word because an agent may commit them.
  PROPOSED: { label: 'Proposed', agencyLabel: 'Request — not sent', tone: 'partial' },
  COMMITTED: { label: 'Assigned', agencyLabel: 'Approved', tone: 'accent' },
  EN_ROUTE: { label: 'On the way', agencyLabel: 'On the way', tone: 'accent' },
  ARRIVED: { label: 'At the address', agencyLabel: 'At the address', tone: 'verified' },
  COMPLETED: { label: 'Done', agencyLabel: 'Done', tone: 'verified' },
  CANCELLED: { label: 'Cancelled', agencyLabel: 'Declined', tone: 'grey' },
}

export function dispatchLabel(d: Pick<DispatchRow, 'status' | 'requires_authorisation' | 'kind'>): string {
  const meta = DISPATCH_META[d.status as DispatchStatus]
  if (!meta) return String(d.status)
  return isAgency(d) ? meta.agencyLabel : meta.label
}

export function dispatchTone(d: Pick<DispatchRow, 'status' | 'requires_authorisation' | 'kind'>): PillTone {
  return DISPATCH_META[d.status as DispatchStatus]?.tone ?? 'grey'
}

/** Is anything actually moving towards this address right now? */
export function isRolling(d: Pick<DispatchRow, 'status'>): boolean {
  return d.status === 'COMMITTED' || d.status === 'EN_ROUTE'
}

export function isLiveDispatch(d: Pick<DispatchRow, 'status'>): boolean {
  return d.status !== 'CANCELLED' && d.status !== 'COMPLETED'
}

/** A prepared agency unit that nobody has approved: the queue on the Approvals screen. */
export function awaitingApproval(d: Pick<DispatchRow, 'status' | 'requires_authorisation'>): boolean {
  return d.status === 'PROPOSED' && d.requires_authorisation === true
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
const INCIDENT_META: Record<IncidentStatus, { label: string; tone: PillTone }> = {
  OPEN: { label: 'Open — nothing sent', tone: 'rejected' },
  TRIAGED: { label: 'Triaged', tone: 'partial' },
  DISPATCHED: { label: 'Unit assigned', tone: 'accent' },
  ON_SCENE: { label: 'Somebody is there', tone: 'verified' },
  RESOLVED: { label: 'Resolved', tone: 'grey' },
  CLOSED: { label: 'Closed', tone: 'grey' },
}

export function incidentStatusLabel(status: string | null | undefined): string {
  return INCIDENT_META[String(status ?? '') as IncidentStatus]?.label ?? String(status ?? '')
}

export function incidentStatusTone(status: string | null | undefined): PillTone {
  return INCIDENT_META[String(status ?? '') as IncidentStatus]?.tone ?? 'grey'
}

export function incidentIsOpen(i: Pick<IncidentRow, 'status'>): boolean {
  return i.status === 'OPEN' || i.status === 'TRIAGED' || i.status === 'DISPATCHED' || i.status === 'ON_SCENE'
}

/** Priority 1 is life safety. `priority_label` comes from the backend; this is only the colour. */
export function priorityTone(priority: number | null | undefined): PillTone {
  const p = Number(priority ?? 5)
  if (p <= 1) return 'rejected'
  if (p === 2) return 'partial'
  if (p === 3) return 'accent'
  return 'grey'
}

/**
 * The board's order: worst first, and within a priority the address nothing has been sent to.
 *
 * An incident with a unit on the way is being handled; an incident of the same priority with
 * nothing assigned is the one a coordinator has to do something about, so it sorts above.
 */
export function incidentOrder(a: IncidentRow, b: IncidentRow): number {
  const byPriority = Number(a.priority ?? 5) - Number(b.priority ?? 5)
  if (byPriority !== 0) return byPriority
  const aSent = a.dispatches.some(isRolling) ? 1 : 0
  const bSent = b.dispatches.some(isRolling) ? 1 : 0
  if (aSent !== bSent) return aSent - bSent
  return a.opened_at.localeCompare(b.opened_at)
}

/** Needs, in the coordinator's words rather than the capability vocabulary's. */
const NEED_LABEL: Record<string, string> = {
  medical: 'paramedic',
  battery: 'backup power',
  medication: 'medication',
  water: 'drinking water',
  ice: 'ice',
  transport: 'a ride out',
  assess: 'somebody to lay eyes on them',
  wheelchair: 'a wheelchair lift',
  forced_entry: 'a crew who can get through the door',
  power: 'power',
}

export function needLabel(capability: string): string {
  return NEED_LABEL[capability] ?? capability.replace(/_/g, ' ')
}

export function needsSentence(needs: string[] | null | undefined): string {
  const list = (needs ?? []).map(needLabel)
  if (list.length === 0) return 'nothing recorded yet'
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

// ---------------------------------------------------------------------------
// Small formatting shared by the map popup, the incident panel and the fleet board
// ---------------------------------------------------------------------------
export function etaText(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return ''
  if (minutes < 1) return 'under a minute'
  return `${Math.round(minutes)} min`
}

export function milesText(miles: number | null | undefined): string {
  if (miles === null || miles === undefined) return ''
  return `${miles.toFixed(1)} mi`
}

/** How long ago the server last moved this unit. Blank until it is worth mentioning. */
export function stalenessText(live: AssetLive | undefined, now: number): string {
  if (!live) return ''
  const seconds = Math.round((now - live.received_at) / 1000)
  if (seconds < 12) return ''
  if (seconds < 90) return `last moved ${seconds}s ago`
  return `last moved ${Math.round(seconds / 60)} min ago`
}
