import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import type { Tracker } from '../tracker/model'
import type { EasedPositions } from '../tracker/useEasedPositions'

/**
 * The vehicles, drawn straight onto Leaflet rather than through React.
 *
 * Two reasons, and both of them are about not lying with a picture.
 *
 * **It has to move at sixty frames a second without re-rendering the page.** A React marker whose
 * position came from state would re-render the incident list and every tracker card on every frame.
 * Here the markers are created once per unit and then only nudged: `setLatLng` and a CSS transform.
 * The numbers beside them stay React's, and change when the server says so.
 *
 * **The icon has to point where the unit is actually going.** The rotation is the bearing of the
 * polyline segment being driven, computed by `app/domain/geo.py::bearing_degrees` and carried on
 * every movement event, so an icon turns at a corner because the vehicle turned, not because a
 * tween decided to. When the server has not reported a bearing — a unit that has never moved — the
 * icon has no nose at all rather than a confident arrow pointing north.
 *
 * Only units with a committed journey are here. A proposed agency unit has no
 * `current_dispatch_id`, so it never becomes a `Tracker`, so nothing about it moves on this map:
 * an ambulance nobody approved cannot appear to be driving anywhere.
 */

const COLOUR = {
  agency: '#b3261e', // p1 — an agency unit is red everywhere in this console
  community: '#2b4c8c', // accent
  arrived: '#2f8a5b', // verified
  stalled: '#8a8b91', // faint
  surface: '#ffffff',
  text: '#17181c',
}

function colourFor(t: Tracker): string {
  if (t.stalled) return COLOUR.stalled
  if (t.phase === 'arrived') return COLOUR.arrived
  return t.agency ? COLOUR.agency : COLOUR.community
}

/** Mono at 11px is about 6.7px a character; the rest is padding and the 1px border. */
function labelWidth(text: string): number {
  return Math.round(text.length * 6.7) + 12
}

/**
 * Everything about a unit that changes the *shape* of its marker.
 *
 * Position and heading are deliberately absent: those change every frame and are applied by moving
 * the existing element, never by rebuilding it. Rebuilding an icon sixty times a second would throw
 * away and re-create a DOM node each frame — and would restart the light bar's animation, so a
 * blue-lit unit would appear to hold one lamp on for ever.
 */
function iconKey(t: Tracker, selected: boolean): string {
  return [t.callSign, colourFor(t), t.phase, t.lightsOn ? 'lit' : '', t.headingDeg === null ? 'nohead' : 'head', selected ? 'sel' : ''].join('|')
}

function vehicleIcon(t: Tracker, selected: boolean): L.DivIcon {
  const colour = colourFor(t)
  const disc = 26
  const width = disc + 3 + labelWidth(t.callSign)

  // A nose only when there is a bearing to point it along; otherwise a plain square, which reads as
  // "here, stationary" and claims no direction.
  const glyph =
    t.headingDeg === null
      ? `<rect x="9.5" y="9.5" width="7" height="7" rx="1.5" fill="${COLOUR.surface}"/>`
      : `<path d="M13 6.4 L17.8 17.2 L13 14.4 L8.2 17.2 Z" fill="${COLOUR.surface}"/>`

  const halo = selected ? `<circle cx="13" cy="13" r="12" fill="none" stroke="${colour}" stroke-width="2" opacity="0.35"/>` : ''

  const beacon = t.lightsOn
    ? `<span style="position:absolute;left:13px;top:-5px;transform:translateX(-50%);display:flex;gap:2px;z-index:2">
         <span class="animate-beaconL" style="width:7px;height:5px;border-radius:1px;background:${COLOUR.agency};box-shadow:0 0 3px ${COLOUR.agency}"></span>
         <span class="animate-beaconR" style="width:7px;height:5px;border-radius:1px;background:${COLOUR.community};box-shadow:0 0 3px ${COLOUR.community}"></span>
       </span>`
    : ''

  return L.divIcon({
    className: 'buddye-vehicle',
    html:
      `<div style="position:relative;display:flex;align-items:center;gap:3px;width:${width}px;height:${disc}px">` +
      beacon +
      // `data-rot` is the one element the animation frame touches. Keeping the label outside it is
      // what stops the call sign from turning upside down when a unit heads south.
      `<span data-rot style="display:block;width:${disc}px;height:${disc}px;flex:none;transform:rotate(${t.headingDeg ?? 0}deg);transform-origin:50% 50%;will-change:transform">` +
      `<svg viewBox="0 0 26 26" width="${disc}" height="${disc}" aria-hidden="true">${halo}` +
      `<circle cx="13" cy="13" r="9" fill="${colour}" stroke="${COLOUR.surface}" stroke-width="2"/>${glyph}</svg></span>` +
      `<span style="display:flex;align-items:center;height:16px;padding:0 4px;border-radius:3px;background:${COLOUR.surface};` +
      `border:1px solid ${colour};color:${COLOUR.text};font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;white-space:nowrap;` +
      `box-shadow:0 1px 2px rgba(16,18,22,.25)">${t.callSign}</span></div>`,
    iconSize: [width, disc],
    // Anchored on the disc, not on the middle of the box: the label hangs off to the right of the
    // actual coordinate rather than dragging the vehicle sideways by half its own name.
    iconAnchor: [disc / 2, disc / 2],
  })
}

export interface VehicleLayerProps {
  trackers: Tracker[]
  eased: EasedPositions
  selectedAssetId: string | null
  onSelect: (assetId: string) => void
}

export function VehicleLayer({ trackers, eased, selectedAssetId, onSelect }: VehicleLayerProps) {
  const map = useMap()
  const markers = useRef(new Map<string, { marker: L.Marker; key: string }>())
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Create, restyle and retire markers. Runs when the fleet's *state* changes — a new dispatch, an
  // arrival, a stall — which is a handful of times a minute, not a handful of times a second.
  useEffect(() => {
    const live = new Set<string>()
    for (const t of trackers) {
      live.add(t.assetId)
      const key = iconKey(t, t.assetId === selectedAssetId)
      const sample = eased.get(t.assetId)
      const position = L.latLng(sample ? sample.lat : t.lat, sample ? sample.lon : t.lon)
      const existing = markers.current.get(t.assetId)

      if (!existing) {
        const marker = L.marker(position, { icon: vehicleIcon(t, t.assetId === selectedAssetId), zIndexOffset: 700, keyboard: false })
        marker.on('click', () => onSelectRef.current(t.assetId))
        marker.addTo(map)
        markers.current.set(t.assetId, { marker, key })
        continue
      }
      if (existing.key !== key) {
        existing.marker.setIcon(vehicleIcon(t, t.assetId === selectedAssetId))
        existing.key = key
      }
      existing.marker.setLatLng(position)
      // The tooltip is the only text on the marker itself; the numbers live on the tracker card,
      // where they are read, and are not duplicated here to drift out of step with it.
      existing.marker.bindTooltip(`${t.callSign} — ${t.kindLabel} to ${t.toName}`, { direction: 'top', offset: [0, -14] })
    }

    for (const [assetId, entry] of [...markers.current.entries()]) {
      if (live.has(assetId)) continue
      entry.marker.remove()
      markers.current.delete(assetId)
    }
  }, [map, trackers, selectedAssetId, eased])

  // Everything above happens rarely. This is the part that runs per frame: read the eased sample,
  // move the marker, turn the icon. No React state is touched.
  useEffect(() => {
    const apply = () => {
      for (const t of trackers) {
        const entry = markers.current.get(t.assetId)
        if (!entry) continue
        const sample = eased.get(t.assetId)
        if (!sample) continue
        entry.marker.setLatLng([sample.lat, sample.lon])
        if (sample.heading === null) continue
        const element = entry.marker.getElement()?.querySelector<HTMLElement>('[data-rot]')
        if (element) element.style.transform = `rotate(${sample.heading}deg)`
      }
    }
    apply()
    return eased.subscribe(apply)
  }, [eased, trackers])

  useEffect(
    () => () => {
      for (const entry of markers.current.values()) entry.marker.remove()
      markers.current.clear()
    },
    [],
  )

  return null
}
