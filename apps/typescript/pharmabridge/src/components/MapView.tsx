"use client";
// Real map (Leaflet + standard OpenStreetMap tiles; CARTO's free tiles now require a key). Loaded client-side only via Map.tsx.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { Circle, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  color: string;
  label?: string;
  pulse?: boolean;
  dim?: boolean;
  selected?: boolean;
  title: string;
  subtitle?: string;
}

const iconCache = new Map<string, L.DivIcon>();

function pinIcon(m: MapMarker): L.DivIcon {
  const key = `${m.color}|${m.label ?? ""}|${m.pulse ? 1 : 0}|${m.dim ? 1 : 0}|${m.selected ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const classes = ["pb-pin", m.dim && "is-dim", m.selected && "is-selected"].filter(Boolean).join(" ");
    icon = L.divIcon({
      className: "pb-divicon",
      html: `<div class="${classes}" style="--pin:${m.color}">${m.pulse ? '<span class="pb-pin-ping"></span>' : ""}<span class="pb-pin-body">${m.label ?? ""}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

const youIcon = L.divIcon({ className: "pb-divicon", html: '<div class="pb-you"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

function FitBounds({ center, markers, fitKey }: { center: { lat: number; lon: number }; markers: MapMarker[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [[center.lat, center.lon], ...markers.map((m) => [m.lat, m.lon] as [number, number])];
    if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.15), { animate: true, maxZoom: 15 });
    else map.setView([center.lat, center.lon], 14);
    // Refit only when the caller signals a new set of places, not on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

export function MapView({
  center,
  radiusKm,
  markers,
  onSelect,
  routes = false,
  fitKey,
  accent = "#a855f7",
}: {
  center: { lat: number; lon: number };
  radiusKm: number;
  markers: MapMarker[];
  onSelect?: (id: string) => void;
  routes?: boolean;
  fitKey: string;
  accent?: string;
}) {
  return (
    <MapContainer center={[center.lat, center.lon]} zoom={14} scrollWheelZoom className="h-full w-full" attributionControl>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Circle
        center={[center.lat, center.lon]}
        radius={radiusKm * 1000}
        pathOptions={{ color: accent, weight: 1.5, opacity: 0.55, fillColor: accent, fillOpacity: 0.05, dashArray: "4 6" }}
      />
      {routes &&
        markers
          .filter((m) => m.pulse)
          .map((m) => (
            <Polyline
              key={`route-${m.id}`}
              positions={[
                [center.lat, center.lon],
                [m.lat, m.lon],
              ]}
              pathOptions={{ color: m.color, weight: 2.5, opacity: 0.85, dashArray: "6 8", className: "route-line" }}
            />
          ))}
      <Marker position={[center.lat, center.lon]} icon={youIcon} zIndexOffset={1000}>
        <Tooltip direction="top" offset={[0, -10]} className="pb-tip">
          Search center
        </Tooltip>
      </Marker>
      {markers.map((m) => (
        <Marker
          key={m.id}
          position={[m.lat, m.lon]}
          icon={pinIcon(m)}
          zIndexOffset={m.pulse ? 600 : m.selected ? 300 : 0}
          eventHandlers={{ click: () => onSelect?.(m.id) }}
        >
          <Tooltip direction="top" offset={[0, -14]} className="pb-tip">
            <strong>{m.title}</strong>
            {m.subtitle ? (
              <>
                <br />
                <span style={{ color: "#64748b" }}>{m.subtitle}</span>
              </>
            ) : null}
          </Tooltip>
        </Marker>
      ))}
      <FitBounds center={center} markers={markers} fitKey={fitKey} />
    </MapContainer>
  );
}
