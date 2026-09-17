import { Fragment, useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Asset, Hazard, IncidentRow, LatLon, StreamState } from '../../types'
import type { BoardPerson } from '../../lib/board'
import { assetPosition, etaText, isAgency, kindLabel, kindShort, milesText, needsSentence } from '../../lib/operator'
import { outcomeLabel } from '../../lib/status'
import type { Tracker, TrackerTarget } from '../tracker/model'
import type { EasedPositions } from '../tracker/useEasedPositions'
import { VehicleLayer } from './VehicleLayer'
import { splitPath } from './path'

/**
 * Maryvale, live, led by what is moving.
 *
 * Everything on this map came off the API. The neighbours' coordinates are the real block-accurate
 * positions in `app.seed`; the staging points are real Phoenix addresses in `app.seed_assets`; the
 * polylines are the routes `app.domain.geo.route_between` computed and the ETAs were measured
 * along; and a vehicle sits where `app.sim.movement` last put it.
 *
 * The map is layered in the order it is read, back to front:
 *
 *   1. tiles, 2. staging points, 3. routes (driven behind, still to come ahead),
 *   4. neighbours and their incidents, 5. the address a unit is going to, 6. the unit itself.
 *
 * The one thing that is not a straight redraw of server state is the vehicle's motion between
 * ticks, and that is confined to `VehicleLayer` and `useEasedPositions`, which interpolate only
 * between two positions the server actually reported and never past the last one. If the backend
 * stops, the vehicles stop — the honest picture of a fleet whose telemetry has gone quiet, and the
 * opposite of what a browser-side dead-reckoning would show.
 *
 * Tiles are OpenStreetMap raster tiles: no key, no account, and the attribution is the condition of
 * using them.
 */

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// The board's palette, as hex, because Leaflet paints into SVG rather than into Tailwind classes.
const C = {
  rejected: '#9a2f2f',
  partial: '#9a6a12',
  verified: '#2f8a5b',
  accent: '#2b4c8c',
  faint: '#8a8b91',
  surface: '#ffffff',
  text: '#17181c',
  p1: '#b3261e',
  p2: '#b5551a',
}

function outcomeColour(outcome: string | null): string {
  switch (outcome) {
    case 'URGENT':
    case 'UNREACHABLE':
      return C.rejected
    case 'NEEDS_HELP':
      return C.partial
    case 'HELP_DECLINED':
      return C.faint
    case 'SAFE':
      return C.verified
    default:
      return C.faint
  }
}

function priorityColour(priority: number | null | undefined): string {
  const p = Number(priority ?? 5)
  if (p <= 1) return C.p1
  if (p === 2) return C.p2
  return C.accent
}

/**
 * Fit the view to the data, once.
 *
 * Once, because refitting on every `asset.moved` would drag the map out from under a coordinator
 * who had panned to the address she cares about. The "Fit the block" button is how she asks again.
 */
function FitToData({ points, token }: { points: LatLon[]; token: string }) {
  const map = useMap()
  const lastToken = useRef<string>('')
  useEffect(() => {
    if (points.length === 0 || lastToken.current === token) return
    lastToken.current = token
    map.fitBounds(L.latLngBounds(points.map(([lat, lon]) => L.latLng(lat, lon))), { padding: [36, 36], maxZoom: 15 })
  }, [map, points, token])
  return null
}

function FitButton({ points }: { points: LatLon[] }) {
  const map = useMap()
  if (points.length === 0) return null
  return (
    <button
      type="button"
      className="absolute right-2 top-2 z-[500] rounded border border-edge bg-surface px-2 py-1 text-11 text-accent shadow"
      onClick={() => map.fitBounds(L.latLngBounds(points.map(([lat, lon]) => L.latLng(lat, lon))), { padding: [36, 36], maxZoom: 15 })}
    >
      Fit the block
    </button>
  )
}

/**
 * Bring a selected unit into view — once per selection, and only if it is off screen.
 *
 * Panning every time the selection's *position* changed would fight a coordinator trying to look
 * somewhere else while a van drives. Selecting a tracker is a question ("where is it?"), so it is
 * answered once.
 */
function FocusAsset({ assetId, trackers, eased }: { assetId: string | null; trackers: Tracker[]; eased: EasedPositions }) {
  const map = useMap()
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!assetId || last.current === assetId) {
      if (!assetId) last.current = null
      return
    }
    last.current = assetId
    const tracker = trackers.find((t) => t.assetId === assetId)
    if (!tracker) return
    const sample = eased.get(assetId)
    const point = L.latLng(sample ? sample.lat : tracker.lat, sample ? sample.lon : tracker.lon)
    if (!map.getBounds().pad(-0.15).contains(point)) map.panTo(point, { animate: true })
  }, [assetId, trackers, eased, map])
  return null
}

/** A parked unit: call sign in a chip, coloured by who owns it, hollow when it is only a request. */
function parkedIcon(callSign: string, kind: string, agency: boolean, proposedOnly: boolean): L.DivIcon {
  const bg = proposedOnly ? C.surface : agency ? C.rejected : C.accent
  const fg = proposedOnly ? C.rejected : C.surface
  const border = agency ? C.rejected : C.accent
  // Leaflet positions a divIcon by the box it is told about, so the box has to be real: an
  // iconSize of [0,0] leaves every chip anchored at its top-left corner and overlapping its
  // neighbours. Mono at 11px is ~6.7px per character; the rest is padding and border.
  const width = Math.round(callSign.length * 6.7) + 14
  const height = 18
  return L.divIcon({
    className: 'buddye-asset-icon',
    html:
      `<div title="${kind}" style="display:flex;align-items:center;justify-content:center;height:${height}px;` +
      `box-sizing:border-box;padding:0 5px;border-radius:4px;opacity:.92;` +
      `background:${bg};color:${fg};border:1.5px ${proposedOnly ? 'dashed' : 'solid'} ${border};` +
      `font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.25)">` +
      `${callSign}</div>`,
    iconSize: [width, height],
    iconAnchor: [Math.round(width / 2), Math.round(height / 2)],
  })
}

/** Several parked units at one coordinate. One chip rather than a pile of unreadable ones. */
function stackIcon(count: number, anyAgency: boolean): L.DivIcon {
  const width = 54
  const height = 18
  return L.divIcon({
    className: 'buddye-asset-stack',
    html:
      `<div style="display:flex;align-items:center;justify-content:center;height:${height}px;width:${width}px;` +
      `box-sizing:border-box;border-radius:4px;background:${C.surface};color:${C.text};opacity:.92;` +
      `border:1.5px solid ${anyAgency ? C.rejected : C.accent};` +
      `font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;box-shadow:0 1px 2px rgba(0,0,0,.25)">` +
      `${count} units</div>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
  })
}

/**
 * The address a unit is driving to.
 *
 * This is the one marker on the map that is allowed to shout. Somewhere on this block there is a
 * door that a van is going to knock on in four minutes, and it must not read as one dot among
 * fourteen: a crosshair in the priority's own colour, the person's name beside it, and the call
 * signs of whoever is inbound. Everything in it comes from the incident row and the dispatch.
 */
function targetIcon(target: TrackerTarget): L.DivIcon {
  // Green once everything has arrived: the crosshair means "somebody is driving here", and when
  // nobody is any more it should stop saying so. The name goes with it — an address with a van
  // already parked outside is no longer the thing on this map that needs finding.
  const colour = target.inbound ? priorityColour(target.priority) : C.verified
  const ring = 30
  const caption = target.inbound ? target.name : ''
  // Stacked, not side by side. Vehicle chips sit at the same coordinate as the address they are
  // driving to, and a caption to the right of the crosshair ends up underneath them at the moment
  // it matters most — the last hundred yards.
  const captionWidth = caption ? Math.round(caption.length * 5.8) + 12 : 0
  const width = Math.max(ring, captionWidth)
  const height = ring + (caption ? 16 : 0)

  return L.divIcon({
    className: 'buddye-target',
    html:
      `<div style="display:flex;flex-direction:column;align-items:center;width:${width}px;height:${height}px">` +
      `<svg viewBox="0 0 30 30" width="${ring}" height="${ring}" style="flex:none" aria-hidden="true">` +
      `<circle cx="15" cy="15" r="13" fill="none" stroke="${colour}" stroke-width="1.5" opacity=".55"/>` +
      `<circle cx="15" cy="15" r="8.5" fill="none" stroke="${colour}" stroke-width="2"/>` +
      `<path d="M15 0.5 V5 M15 25 V29.5 M0.5 15 H5 M25 15 H29.5" stroke="${colour}" stroke-width="2" stroke-linecap="round"/>` +
      `</svg>` +
      (caption
        ? `<span style="margin-top:1px;display:flex;align-items:center;height:15px;padding:0 5px;border-radius:3px;` +
          `background:${C.surface};border:1px solid ${colour};color:${C.text};` +
          `font:600 11px/1 'IBM Plex Sans',sans-serif;white-space:nowrap;box-shadow:0 1px 2px rgba(16,18,22,.18)">${caption}</span>`
        : '') +
      `</div>`,
    iconSize: [width, height],
    // Anchored on the middle of the crosshair, so the rings sit on the address and the caption
    // hangs below it.
    iconAnchor: [width / 2, ring / 2],
  })
}

/**
 * A staging point: where a unit lives when it is not out.
 *
 * Only the named place carries its name on the map. Three identical "Staging point" captions across
 * the same few blocks is clutter that hides the thing the caption was for; the rest say who they
 * are in the popup, where somebody is actually asking.
 */
function baseIcon(label: string, named: boolean): L.DivIcon {
  const caption = named
    ? `<span style="background:rgba(255,255,255,.88);padding:1px 3px;border-radius:3px;white-space:nowrap">${label}</span>`
    : ''
  const width = named ? 14 + Math.round(label.length * 5.4) : 12
  return L.divIcon({
    className: 'buddye-base-icon',
    html:
      `<div style="display:flex;align-items:center;gap:4px;height:12px;font:500 10px/1 'IBM Plex Sans',sans-serif;color:${C.text}">` +
      `<span style="width:9px;height:9px;flex:none;background:${C.surface};border:2px solid ${C.text};transform:rotate(45deg)"></span>` +
      `${caption}</div>`,
    iconSize: [width, 12],
    iconAnchor: [6, 6],
  })
}

export interface OpsMapProps {
  people: BoardPerson[]
  incidents: IncidentRow[]
  assets: Asset[]
  stream: StreamState
  hazard: Hazard | null
  /** Everything with a committed journey, from `components/tracker/model`. */
  trackers: Tracker[]
  /** The addresses those journeys end at, one per deployment case. */
  targets: TrackerTarget[]
  eased: EasedPositions
  selectedAssetId: string | null
  onSelectAsset: (assetId: string) => void
  selectedIncidentId?: string | null
  onOpenIncident: (incidentId: string) => void
  onOpenPerson: (neighbourId: string) => void
  className?: string
}

export function OpsMap({
  people,
  incidents,
  assets,
  stream,
  hazard,
  trackers,
  targets,
  eased,
  selectedAssetId,
  onSelectAsset,
  selectedIncidentId,
  onOpenIncident,
  onOpenPerson,
  className,
}: OpsMapProps) {
  const incidentByNeighbour = useMemo(() => {
    const m = new Map<string, IncidentRow>()
    for (const i of incidents) {
      const prev = m.get(i.neighbour_id)
      if (!prev || i.opened_at >= prev.opened_at) m.set(i.neighbour_id, i)
    }
    return m
  }, [incidents])

  /**
   * A journey's polyline, cut where the vehicle has got to.
   *
   * One line per tracker, because a tracker exists only where an asset has a committed dispatch —
   * which is exactly the set of journeys somebody is actually on. A PROPOSED agency unit has no
   * `current_dispatch_id`, so it is not a tracker, so no line is drawn from a fire station to a
   * frail woman's house for a request nobody has approved.
   *
   * The cut point is `Dispatch.progress` walked along the polyline by length, the same walk
   * `app/domain/geo.py::point_along_path` does — so the join sits under the vehicle rather than
   * near it.
   */
  const journeys = useMemo(
    () =>
      trackers
        .filter((t) => t.route.length >= 2 && t.phase !== 'arrived')
        .map((t) => ({
          assetId: t.assetId,
          colour: t.stalled ? C.faint : t.agency ? C.p1 : C.accent,
          ...splitPath(t.route, t.percentComplete === null ? 0 : t.percentComplete / 100),
        })),
    [trackers],
  )

  /** Incidents a unit is currently driving to. They get the crosshair instead of a plain ring. */
  const targetIncidentIds = useMemo(() => new Set(targets.map((t) => t.incidentId)), [targets])

  /**
   * Staging points, grouped by coordinate — and the community centre named from the hazard's own
   * help offers.
   *
   * The cooling centre is not a constant in this file: it is the base the community fleet stages
   * from, and its name is the label of whichever `help_offered` entry the backend wrote for this
   * hazard (a cooling centre under a heat warning, a resource centre with a generator under an
   * outage). Both halves come off the API; neither is typed in here.
   */
  const bases = useMemo(() => {
    const groups = new Map<string, { lat: number; lon: number; signs: string[]; community: number }>()
    for (const a of assets) {
      if (typeof a.base_lat !== 'number' || typeof a.base_lon !== 'number') continue
      const key = `${a.base_lat.toFixed(5)},${a.base_lon.toFixed(5)}`
      const g = groups.get(key) ?? { lat: a.base_lat, lon: a.base_lon, signs: [], community: 0 }
      g.signs.push(a.call_sign)
      if (!isAgency(a)) g.community += 1
      groups.set(key, g)
    }
    const rows = [...groups.values()]
    const centre = rows.reduce<(typeof rows)[number] | null>((best, g) => (!best || g.community > best.community ? g : best), null)
    const offer = (hazard?.help_offered ?? []).find((o) => o.key === 'cooling_center' || o.key === 'resource_center')
    return rows.map((g) => {
      const named = g === centre && g.community > 0 && !!offer
      return { ...g, named, label: named && offer ? offer.label : 'Staging point', text: named && offer ? offer.text : '' }
    })
  }, [assets, hazard])

  /**
   * Parked units, grouped by the coordinate they are actually at.
   *
   * Anything with a journey is drawn by `VehicleLayer` instead and is excluded here, so a van never
   * appears twice. Six volunteers at the same community centre are six markers on the same pixel,
   * and the fix is not to nudge them apart — a vehicle drawn where it is not is exactly the kind of
   * lie this layer avoids. They become one chip that says how many, and the popup names each.
   */
  const parkedGroups = useMemo(() => {
    const moving = new Set(trackers.map((t) => t.assetId))
    const m = new Map<string, { lat: number; lon: number; units: Asset[] }>()
    for (const a of assets) {
      if (moving.has(a.id)) continue
      const pos = assetPosition(a, stream.assetPositions[a.id])
      if (!pos.lat || !pos.lon) continue
      const key = `${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}`
      const g = m.get(key) ?? { lat: pos.lat, lon: pos.lon, units: [] }
      g.units.push(a)
      m.set(key, g)
    }
    return [...m.values()]
  }, [assets, stream.assetPositions, trackers])

  const points = useMemo<LatLon[]>(() => {
    const out: LatLon[] = []
    for (const p of people) if (p.n.lat && p.n.lon) out.push([p.n.lat, p.n.lon])
    for (const a of assets) if (a.lat && a.lon) out.push([a.lat, a.lon])
    for (const b of bases) out.push([b.lat, b.lon])
    return out
  }, [people, assets, bases])

  // Refit only when the SET of places changes (a reset, a new block), never when one moves.
  const fitToken = useMemo(() => `${people.length}:${assets.length}:${bases.length}`, [people.length, assets.length, bases.length])

  if (points.length === 0) {
    return (
      <div className={className}>
        <div className="card flex h-full items-center justify-center px-4 text-center text-13 text-muted">
          No coordinates yet — the map draws once the block and the fleet have loaded.
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="relative h-full overflow-hidden rounded border border-border">
        <MapContainer center={[points[0][0], points[0][1]]} zoom={14} scrollWheelZoom className="h-full w-full" attributionControl>
          <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />
          <FitToData points={points} token={fitToken} />
          <FitButton points={points} />
          <FocusAsset assetId={selectedAssetId} trackers={trackers} eased={eased} />

          {bases.map((b) => (
            <Marker key={`base-${b.lat},${b.lon}`} position={[b.lat, b.lon]} icon={baseIcon(b.label, b.named)}>
              <Popup>
                <div className="text-12">
                  <div className="font-semibold text-text">{b.label}</div>
                  {b.text && <p className="mt-1 max-w-[220px] text-muted">{b.text}</p>}
                  <div className="mt-1 font-mono text-11 text-faint">Based here: {b.signs.join(', ')}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {journeys.map((j) => (
            <Fragment key={`journey-${j.assetId}`}>
              {j.travelled.length >= 2 && (
                <Polyline
                  positions={j.travelled.map(([lat, lon]) => [lat, lon] as [number, number])}
                  pathOptions={{ color: j.colour, weight: 3, opacity: 0.22, interactive: false }}
                />
              )}
              {j.remaining.length >= 2 && (
                <Polyline
                  positions={j.remaining.map(([lat, lon]) => [lat, lon] as [number, number])}
                  pathOptions={{
                    color: j.colour,
                    weight: j.assetId === selectedAssetId ? 5 : 3,
                    opacity: j.assetId === selectedAssetId ? 0.95 : 0.7,
                    interactive: false,
                  }}
                />
              )}
            </Fragment>
          ))}

          {people.map((p) => {
            if (!p.n.lat || !p.n.lon) return null
            const incident = incidentByNeighbour.get(p.n.id) ?? null
            const colour = outcomeColour(p.outcome)
            const selected = !!incident && incident.id === selectedIncidentId
            const rolling = trackers.filter((t) => t.incidentId === incident?.id)
            const waiting = incident?.awaiting_authorisation ?? []
            // An address something is driving to wears the crosshair below; a second plain ring
            // around it would only blur the one marker on this map that is meant to be loud.
            const ringed = !!incident && !targetIncidentIds.has(incident.id)
            return (
              <Fragment key={`person-${p.n.id}`}>
                {incident && ringed && (
                  <CircleMarker
                    center={[p.n.lat, p.n.lon]}
                    radius={selected ? 16 : 12}
                    pathOptions={{
                      color: priorityColour(incident.priority),
                      weight: selected ? 3 : 2,
                      fill: false,
                      dashArray: waiting.length > 0 ? '4 3' : undefined,
                      interactive: false,
                      className: 'buddye-incident-ring',
                    }}
                  />
                )}
                <CircleMarker
                  center={[p.n.lat, p.n.lon]}
                  radius={7}
                  pathOptions={{ color: C.surface, weight: 2, fillColor: colour, fillOpacity: 1, className: 'buddye-neighbour' }}
                >
                  <Popup>
                    <div className="min-w-[210px] text-12">
                      <div className="text-13 font-semibold text-text">{p.n.name}</div>
                      <div className="text-muted">{p.n.address}{p.n.unit ? `, ${p.n.unit}` : ''}</div>
                      <div className="mt-1.5 font-medium" style={{ color: colour }}>
                        {p.outcome ? outcomeLabel(p.outcome) : p.notDialledReason ? 'Not called' : 'Not called yet'}
                      </div>
                      {p.reason && <p className="mt-1 text-muted">{p.reason}</p>}

                      {incident && (
                        <div className="mt-2 border-t border-divider pt-1.5">
                          <div className="font-medium text-text">
                            Incident · {incident.priority_label} · {incident.status.replace(/_/g, ' ').toLowerCase()}
                          </div>
                          <div className="text-muted">Needs {needsSentence(incident.needs)}</div>
                          {/* Health facts appear here, where somebody is deciding what to send —
                              never in a list view. */}
                          {(incident.power_dependent || incident.conditions.length > 0) && (
                            <div className="mt-1 text-muted">
                              {incident.power_dependent ? 'Depends on mains power. ' : ''}
                              {incident.conditions.join(', ')}
                            </div>
                          )}
                          {p.n.access_notes && <div className="mt-1 text-muted">Access: {p.n.access_notes}</div>}
                          {rolling.map((t) => (
                            <div key={t.assetId} className="mt-1 text-accent">
                              {t.callSign}{' '}
                              {t.phase === 'arrived'
                                ? 'is at the address'
                                : t.phase === 'assigned'
                                  ? 'assigned, not moving yet'
                                  : `on the way — ${etaText(t.etaMinutes)}, ${milesText(t.remainingMiles)}`}
                            </div>
                          ))}
                          {waiting.map((d) => (
                            <div key={d.id} className="mt-1 font-medium text-rejected">
                              {kindLabel(d.kind)} {d.call_sign} requested — waiting on a person. Nothing has been sent.
                            </div>
                          ))}
                          {rolling.length === 0 && waiting.length === 0 && (
                            <div className="mt-1 text-muted">Nothing has been sent to this address yet.</div>
                          )}
                          <button type="button" className="mt-2 text-accent underline" onClick={() => onOpenIncident(incident.id)}>
                            Open the incident
                          </button>
                        </div>
                      )}
                      {!incident && (
                        <button type="button" className="mt-2 text-accent underline" onClick={() => onOpenPerson(p.n.id)}>
                          Open their check-in
                        </button>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              </Fragment>
            )
          })}

          {targets.map((t) => (
            <Marker
              key={`target-${t.incidentId}`}
              position={[t.lat, t.lon]}
              icon={targetIcon(t)}
              zIndexOffset={400}
              eventHandlers={{ click: () => onOpenIncident(t.incidentId) }}
            />
          ))}

          {parkedGroups.map((group) => {
            const key = group.units.map((u) => u.id).sort().join('+')
            const first = group.units[0]
            const agency = isAgency(first)
            // A unit whose only dispatch is a request nobody has approved is drawn hollow: it is
            // sitting at its station and it has not been asked to move.
            const proposedOnly =
              agency && first.status === 'AVAILABLE' && incidents.some((i) => i.awaiting_authorisation.some((d) => d.asset_id === first.id))
            const icon =
              group.units.length === 1
                ? parkedIcon(first.call_sign, kindLabel(first.kind), agency, proposedOnly)
                : stackIcon(group.units.length, group.units.some(isAgency))
            return (
              <Marker key={`parked-${key}`} position={[group.lat, group.lon]} icon={icon} zIndexOffset={300}>
                <Popup>
                  <div className="min-w-[200px] space-y-2 text-12">
                    {group.units.map((a) => (
                      <div key={a.id}>
                        <div className="text-13 font-semibold text-text">
                          {a.call_sign} · {kindShort(a.kind)}
                        </div>
                        <div className="text-muted">
                          {kindLabel(a.kind)} — {a.operator_name}
                        </div>
                        {isAgency(a) && (
                          <div className="font-medium text-rejected">Agency unit. Only a named person can send this.</div>
                        )}
                        <div className="text-text">{a.status.replace(/_/g, ' ').toLowerCase()}</div>
                        {a.notes && <p className="max-w-[220px] text-faint">{a.notes}</p>}
                      </div>
                    ))}
                  </div>
                </Popup>
              </Marker>
            )
          })}

          <VehicleLayer trackers={trackers} eased={eased} selectedAssetId={selectedAssetId} onSelect={onSelectAsset} />
        </MapContainer>
      </div>
    </div>
  )
}

/** The key, printed under the map. Small on purpose: the map should be readable without it. */
export function MapLegend() {
  const dot = (colour: string) => <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colour }} />
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-11 text-muted">
      <span className="flex items-center gap-1.5">{dot(C.rejected)} urgent or no answer</span>
      <span className="flex items-center gap-1.5">{dot(C.partial)} needs help</span>
      <span className="flex items-center gap-1.5">{dot(C.verified)} safe</span>
      <span className="flex items-center gap-1.5">{dot(C.faint)} not called</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border-2" style={{ borderColor: C.p1 }} /> incident
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-dashed" style={{ borderColor: C.rejected }} /> waiting on an approval
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="13" height="13" viewBox="0 0 30 30" aria-hidden="true">
          <circle cx="15" cy="15" r="13" fill="none" stroke={C.p1} strokeWidth="2" opacity=".55" />
          <circle cx="15" cy="15" r="8.5" fill="none" stroke={C.p1} strokeWidth="3" />
        </svg>
        address a unit is going to
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="9" fill={C.accent} stroke={C.surface} strokeWidth="2" />
          <path d="M13 6.4 L17.8 17.2 L13 14.4 L8.2 17.2 Z" fill={C.surface} />
        </svg>
        unit, pointing the way it is driving
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-[3px] w-5 rounded-sm" style={{ background: C.accent, opacity: 0.7 }} /> still to drive
        <span className="ml-1 inline-block h-[3px] w-5 rounded-sm" style={{ background: C.accent, opacity: 0.22 }} /> already driven
      </span>
    </div>
  )
}
