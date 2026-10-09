# BuddyE frontend

Vite + React 18 + TypeScript + Tailwind v3 + Leaflet console for the BuddyE backend. It follows one
hazard live from the backend's SSE stream: the triaged roster, every welfare call (the CALL-E call
contract in, the typed `structured_result` out, the transcript), the escalation ladder and handoff
packets, incidents and the dispatch authorisation queue, and the fleet on a map.

The rules this console has to satisfy (nothing may look like a dispatch, silence is visible) are in
[`../docs/DESIGN.md`](../docs/DESIGN.md).

## Run

Requires Node 22 (`nvm use 22`). The backend must be running on `http://127.0.0.1:8000`
(see `../backend`).

```bash
npm install
npm run dev        # http://localhost:5173 (add --port 5174 if 5173 is taken)
```

In dev, `vite.config.ts` proxies `/api/*` (including the SSE endpoint
`/api/stream/hazards/{id}`) to the backend, so the app talks to the API same-origin and no CORS is
involved. Set `BUDDYE_API=http://127.0.0.1:<port>` to point the proxy at a backend on another port.

## Build

```bash
npm run build      # tsc -b && vite build -> dist/
npm run preview
```

### `VITE_API_BASE`

Every request is built as `${VITE_API_BASE}/api/...`. The default is `''` (same origin), which is
what the dev proxy expects. For a production build served from a different origin than the API, set
it at build time:

```bash
VITE_API_BASE=https://buddye-api.example.com npm run build
```

The backend's `CORS_ORIGINS` must then include the frontend's origin. `vercel.json` carries the
single-page-app rewrite for a static host.

## Routes

- `/` — lands on the newest hazard and rewrites the address.
- `/hazards/:hazardId` — operations: the map, approved deployments being watched.
- `/hazards/:hazardId/sweep` — the board: every neighbour, worst first, with outcomes and the
  unaccounted list.
- `/hazards/:hazardId/sweep/:neighbourId` — one person's case: triage reasons, calls and transcripts,
  the ladder, handoff packets, and the button that rings them.
- `/hazards/:hazardId/incidents[/:incidentId]` — incidents and their dispatches, including the
  agency units waiting for a named human.
- `/hazards/:hazardId/approvals` — the record of what was authorised or declined, and by whom.
- `/hazards/:hazardId/fleet` — every unit, its position, route and ETA.
- `/hazards/:hazardId/live` — the original single-page console, kept as a deep link.

## Live state

`HazardLayout` is a layout route that owns the SSE connection, so moving between pages re-renders
instead of reconnecting. `src/hooks/useEventStream.ts` reads the history from
`GET /api/stream/hazards/{id}/history`, then opens the stream with `?since_event_id=<last id>`, so a
laptop that slept comes back to a correct board. The stream is consumed with a small fetch +
`ReadableStream` parser (`src/sse.ts`) rather than `EventSource`, because the server names events
with `event:` and every type, known or not, must reach the reducer.

Map positions, routes and ETAs come from the server and are never computed or animated client-side:
if the backend stops, the vehicles stop where they were. Tiles are OpenStreetMap.
