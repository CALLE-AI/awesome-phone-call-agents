# The map: what is real and what is simulated

`backend/app/domain/geo.py`, `app/sim/movement.py`, `app/api/assets.py`, `app/seed_assets.py`.
Tests: `tests/test_geo_movement.py`.

A map of vehicles moving around a city is the easiest thing in this product to fake and the most
expensive thing to have faked. A coordinator plans around an ETA once; if it turns out to have been
a CSS transition, they stop believing the screen, and then they stop believing the parts of the
screen that were true. So this page is a list of exactly what is computed, what is approximated and
how, and the single thing that is pretended.

**The one pretence is that no driver is behind the wheel.** Everything downstream of that —
positions, distances, bearings, routes, ETAs, arrival, the state machine — behaves as it would with a
live GPS feed, because it is the same code that would run against one.

---

## Real

### The coordinates

Every neighbour and every staging point sits at a genuine Maryvale, Phoenix location. The people and
the crews are fictional; the streets are not.

```
Maryvale Community Center / Palo Verde Library    4420 N 51st Ave      33.5020, -112.1697
Cartwright Elementary School District #83 yard    5220 W Indian School 33.4948, -112.1714
Phoenix Fire Station 15                           4730 N 43rd Ave      33.5060, -112.1494
Phoenix Fire Station 25                           4010 N 63rd Ave      33.4973, -112.1938
Phoenix PD Maryvale Estrella Mountain Precinct    6180 W Encanto Blvd  33.4730, -112.1920
```

Latitudes are anchored on the Phoenix mile grid — Campbell 33.5020, Indian School 33.4948, Osborn
33.4874, Thomas 33.4802, Encanto 33.4730 — and longitudes on the avenue spacing the roster already
uses. **They are accurate to the block, not to the doorstep**, and that is the claim the seed data
makes for itself rather than a larger one. A coordinator can check the screen against the world and
find the community centre where the map says it is.

### Positions are persisted server state

`Asset.lat`, `Asset.lon`, `Asset.heading_deg`, `Asset.last_moved_at`, `Dispatch.progress`. Columns on
rows in the database.

This is the load-bearing sentence: **if the backend stops, the vehicles stop where they were.** Not
where a page reload puts them, not back at base. Two browsers watching the same van see the same
van, because both are reading the same row. Reloading does not restart anything. A laptop that slept
comes back to where the fleet actually is, not to where it was when the tab lost focus.

`GET /api/assets/positions` is what the map layer polls, and what it is *not* is a seed for a browser
animation. A client may interpolate between two polls for smoothness. It must never invent a
position, and it never needs to, because `progress` and `eta_minutes` in that payload are computed
from the route the vehicle is actually on.

### The clock is the wall clock

`sim/movement.advance_dispatch()` computes progress from **wall-clock time elapsed since the last
tick** and the asset's own `speed_mph`:

```python
elapsed_hours  = (now - (asset.last_moved_at or dispatch.committed_at or now)).total_seconds() / 3600
moved_fraction = (asset.speed_mph * elapsed_hours) / path_length_miles(dispatch.route)
```

Nothing is scripted to complete "after N frames". An asset five minutes out arrives five minutes
later. `MOVEMENT_TICK_S` (default 2.0) is **purely a smoothness knob**: a longer tick means chunkier
movement, never a later arrival, and a tick the event loop skipped changes nothing about when a
vehicle arrives — only how often you see it move. A tick that raises an exception is logged and
swallowed; the calls are the product and the map is a view of them.

### The ETA is measured along the polyline the map draws

This is the strongest true claim on this page, and it is stronger than "the ETAs are real".

`dispatch.start()` computes the route once with `geo.route_between()`, writes it to `Dispatch.route`,
and measures the ETA along **that** polyline with `geo.path_length_miles` — not as the crow flies.
`app/api/assets.py` draws that same array. `sim/movement` walks that same array with
`geo.point_along_path`. So the path you watch, the path the promise was measured on, and the path the
vehicle is advanced along are one object.

What you watch and what you were promised **cannot** drift apart, because there is nothing for them
to drift between.

`_live()` in the assets API recomputes ETA from the *remaining* length of the route rather than
reading `Dispatch.eta_minutes` off the row, because the stored value is the promise made at departure
and the question a coordinator is asking is "when will it be here?" asked now. Both are on the wire;
they mean different things.

### Bearing turns at the corner

`point_along_path` returns the bearing of the segment actually being travelled, so an icon turns at
the corner instead of pointing at its destination the whole way. A stopped asset never arrives and
says so with `inf` rather than a number: `eta_minutes(d, 0) == math.inf`.

---

## Approximated, and the approximation is named

None of these are invented numbers. All of them are documented arithmetic over real coordinates, and
each is a place a production deployment would substitute a better source without changing anything
above it.

| Thing | What BuddyE does | What production would do |
| --- | --- | --- |
| Road distance | `GRID_DETOUR_FACTOR = 1.27` × great-circle. Phoenix is a grid city and 1.27 is close to the true factor for arbitrary origin/destination pairs on one. | A routing engine (OSRM, Valhalla, a commercial matrix API) |
| The route shape | `route_between()` builds an L-shaped polyline along the grid — `legs` turns, alternating east-west and north-south | The routing engine's own geometry |
| Interpolation | `interpolate()` is linear in degrees, not a great-circle slerp | Unchanged. Across a few miles of one city the difference is far below the precision of everything else here, and being obvious matters more |
| Speed | A constant `speed_mph` per asset — 18 for a loaded truck, 20-25 for a van, 30-32 for an agency unit. Surface streets, Phoenix, with stops | Live speed from the AVL feed; traffic from the routing engine |
| Arrival | Within `ARRIVAL_TOLERANCE_MILES = 0.02` of the end, rather than creeping toward a coordinate floating point will never exactly equal | A geofence, or the crew pressing "on scene" |

Better than pretending vehicles fly; cheaper than a routing engine; honest about which it is. The
important property is that **an approximation is a stated constant in one module**, not a fudge
scattered through the code, so replacing it is an edit rather than an investigation.

---

## Simulated

One thing: **nobody is driving.**

That is the entire content of `app/sim/movement.py`, and the module says so in its own docstring. It
is the only place in BuddyE where something is pretended.

Everything it touches is real state:

```python
dispatch.progress = progress               # 0..1 along the route
asset.lat, asset.lon, asset.heading_deg    # persisted position
asset.last_moved_at = now                  # the clock the next tick measures from
```

`MovementSimulator` owns the ticking — one per process, started with the app in `lifespan`, stopped
with it. The session factory it is given is `session_scope`, which **commits on exit**; a bare
`Session` would advance positions in memory and throw them away every tick, and a restart would put
every van back at base.

---

## Never in the frontend

The console must never contain:

- a hardcoded coordinate
- a hardcoded or client-estimated ETA
- a "demo path", a scripted route, or an animation that advances a vehicle on a timer
- a position derived from anything except `GET /api/assets/positions`, `GET /api/assets`, or the
  `asset.moved` / `asset.arrived` events

Smoothing between two polled positions is fine and is what a real AVL console does. Inventing the
next position is not, and it is never necessary: `progress`, `remaining_miles` and `eta_minutes` all
arrive computed.

The same rule the design contract states for the rest of the console applies here — **do not derive
state you were told.** The route arrives in the payload. So does the ETA. So does whether the
dispatch has arrived.

---

## Swapping in a live AVL feed

The vehicle layer is replaceable, and `app/sim/movement.py` is the only file that has to go. That is
by construction: the simulator knows about dispatches and assets and deliberately nothing about
hazards, and `main.MovementPublisher` is the join that turns its change records into hazard-scoped
bus events.

### The positional half

A real feed writes the same five columns the simulator writes, on whatever cadence the vendor pushes:

```
Asset.lat, Asset.lon, Asset.heading_deg, Asset.last_moved_at, Dispatch.progress
```

Everything above that is unchanged. `GET /api/assets/positions` still reads rows. The map still draws
rows. `MovementPublisher` still emits `asset.moved`. `fleet.eligible` still computes distance from
`Asset.lat/lon` and the incident's coordinates — with a live feed those become live distances and the
ranking gets better without a line changing.

Two knobs to drop on the way: `MOVEMENT_TICK_S` becomes the vendor's push rate, and `speed_mph`
becomes an ETA input only (`geo.eta_minutes` still needs *a* speed, but it can be the observed one).

### The half that is not positional, and is the reason this section exists

`advance_dispatch()` does more than move a dot. When it decides an asset has arrived it also:

```python
dispatch.status   = DispatchStatus.ARRIVED     # via assert_dispatch_transition
dispatch.arrived_at = now
asset.status      = AssetStatus.ON_SCENE       # via assert_asset_transition
incident.status   = IncidentStatus.ON_SCENE    # first arrival only; later ones do not move it back
```

**A position feed does not produce that.** A vendor pushing lat/lon has no opinion about whether a
crew is on scene, and `ARRIVAL_TOLERANCE_MILES` is the simulator's stand-in for a judgment somebody
else would be making. A live integration needs one of:

- a **geofence** — the same tolerance test, run against the feed's coordinates rather than against a
  computed progress cursor. Cheapest, and it is very nearly the code that already exists;
- a **crew signal** — the radio call or the MDT button that says "on scene". This is what an actual
  CAD system uses, because a unit parked round the corner is not on scene and a unit in the driveway
  with nobody out of it is not either;
- **both**, with the geofence proposing and the crew signal confirming.

Whichever is chosen, it calls the same `assert_dispatch_transition` / `assert_asset_transition`
helpers. The state machine is not part of the vehicle layer and does not move when the vehicle layer
does.

### What must not change

`app/orchestrator/dispatch.py` stays the only place a `Dispatch` changes state, and the authorisation
boundary is not on this seam at all: an AVL feed reports where an ambulance *is*, and has nothing to
say about whether one may be sent. See [`DISPATCH.md`](DISPATCH.md).

---

## Payloads

`GET /api/assets/positions` — small on purpose, because a browser polls it and the interesting fields
are the ones that change:

```json
{"assets": [{"id": "ast_…", "call_sign": "WV-1", "kind": "WELLNESS_VAN", "status": "EN_ROUTE",
             "lat": 33.4996, "lon": -112.1723, "heading_deg": 214.6,
             "requires_authorisation": false, "dispatch_id": "dsp_…",
             "progress": 0.4137, "last_moved_at": "2026-09-09T…Z"}],
 "count": 12, "en_route": 3}
```

`GET /api/assets` adds everything static — capabilities, capacity, spare capacity, speed, base, notes
— plus a `destination` block when the unit is moving: the incident it is going to, the address, the
full `route` polyline, `remaining_miles`, and the recomputed `eta_minutes`.

`asset.moved` / `asset.arrived` events carry the change record the simulator produced —
`dispatch_id`, `asset_id`, `call_sign`, `lat`, `lon`, `heading_deg`, `progress`, `remaining_miles`,
`eta_minutes`, `arrived` — plus the `incident_id` the publisher joined on. Full shapes in
[`API.md`](API.md).

Everything goes through `app.obs.redact` on the way out, like everything else that leaves the
process.
