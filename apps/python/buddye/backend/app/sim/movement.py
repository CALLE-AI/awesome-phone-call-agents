"""Advance dispatched assets along their routes on a real clock.

No vehicle is really driving, and this module is the only place in BuddyE where that is true. It is
worth being precise about what it does and does not fake, because the value of the map depends on
it:

* **The position is real state.** It lives on the `Asset` row, it is written to the database, and
  every client watching the map reads the same row. Kill the process and the vans stop where they
  were; restart it and they carry on from there.
* **The clock is real.** Progress is computed from wall-clock time elapsed since the last tick and
  the asset's own `speed_mph`, so an asset five minutes out arrives five minutes later. Nothing is
  scripted to complete "after N frames", and a slow or skipped tick changes nothing about when a
  vehicle arrives — only how often you see it move.
* **The route is the one the ETA came from.** Positions are walked along `Dispatch.route`, the same
  polyline the map draws and the same one `eta_minutes` measured, so what you watch and what you
  were promised cannot drift apart.

What is simulated is only that no real driver is behind the wheel. Everything downstream of that —
distance, bearing, arrival, the state machine — behaves exactly as it would with live GPS, which is
what makes the vehicle layer swappable for a real AVL feed later without touching anything else.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Callable, Iterable

from sqlmodel import Session, select

from app.domain.geo import path_length_miles, point_along_path
from app.domain.state import (
    AssetStatus,
    DispatchStatus,
    IncidentStatus,
    assert_asset_transition,
    assert_dispatch_transition,
    requires_authorisation,
)
from app.models import Asset, Dispatch, Incident, utcnow

log = logging.getLogger("buddye.sim")

#: How often the simulator wakes. Purely a smoothness knob: arrival times are computed from elapsed
#: wall-clock time, so a longer tick means chunkier movement, never a later arrival.
TICK_SECONDS = 2.0

#: Below this fraction of a mile from the destination an asset is treated as arrived, rather than
#: creeping toward a coordinate it will never exactly equal in floating point.
ARRIVAL_TOLERANCE_MILES = 0.02

#: The priority at which an agency unit under way runs its light bar. `domain.fleet` calls 1 "life
#: safety"; a water drop is never one, which is the whole point of the distinction.
LIGHTS_PRIORITY = 1

#: Sixteen points, so a heading reads as a word on a tracker rather than as three digits a tired
#: person has to convert. Derived from the bearing the asset is actually travelling on.
COMPASS = ("N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW")


def compass_point(heading_deg: float | None) -> str:
    """The heading as a compass word. "" when the asset has no heading yet — never a guessed "N"."""
    if heading_deg is None:
        return ""
    return COMPASS[int((float(heading_deg) % 360.0) / 22.5 + 0.5) % 16]


def running_lights(asset: Asset, dispatch: Dispatch, incident: Incident | None) -> bool:
    """Is this unit running its light bar right now?

    Three conditions, all of them facts on rows rather than a display choice: it is an agency unit
    (`domain.state.requires_authorisation` is the single source of truth for that, so a kind added
    later cannot quietly acquire lights), it is actually moving, and the incident it is moving to is
    priority 1. A wellness van with a case of water is never blue-lit, and neither is an EMS unit
    that a human has authorised but that has not rolled yet.

    The authorisation property holds by construction: an agency dispatch cannot reach EN_ROUTE
    without a named human approving it, so nothing can be lit that nobody approved.
    """
    if incident is None or DispatchStatus(dispatch.status) is not DispatchStatus.EN_ROUTE:
        return False
    return requires_authorisation(asset.kind) and int(incident.priority or 5) <= LIGHTS_PRIORITY


def advance_dispatch(dispatch: Dispatch, asset: Asset, *, now: datetime,
                     incident: Incident | None = None) -> dict[str, Any] | None:
    """Move one asset for however long has actually passed. Returns a change record, or None.

    Split out from the loop so the interesting behaviour can be tested by handing it two
    timestamps instead of waiting for a real two seconds to elapse.

    `incident` is optional because the movement maths does not need it; it is passed by `tick` so
    the change record can say whether the unit is running its lights, which depends on the priority
    of the thing it is going to. Without it the record simply says `lights_on: false` — a tracker
    that cannot establish that a unit is blue-lit must not draw it as though it were.

    The change record is the whole contract with the tracker widget on the map: speed, heading,
    distance remaining, ETA and percent complete are all computed here, from persisted state and the
    wall clock, so a browser never has to estimate any of them between ticks.
    """
    if dispatch.status != DispatchStatus.EN_ROUTE or not dispatch.route:
        return None

    since = asset.last_moved_at or dispatch.committed_at or now
    elapsed_hours = max(0.0, (now - since).total_seconds() / 3600.0)
    if elapsed_hours <= 0:
        return None

    total_miles = path_length_miles(dispatch.route)
    if total_miles <= 0:
        moved_fraction = 1.0
    else:
        moved_fraction = (asset.speed_mph * elapsed_hours) / total_miles

    progress = min(1.0, dispatch.progress + moved_fraction)
    lat, lon, heading = point_along_path(dispatch.route, progress)

    dispatch.progress = progress
    asset.lat, asset.lon, asset.heading_deg = lat, lon, heading
    asset.last_moved_at = now

    remaining_miles = total_miles * (1.0 - progress)
    arrived = progress >= 1.0 or remaining_miles <= ARRIVAL_TOLERANCE_MILES
    if arrived:
        assert_dispatch_transition(DispatchStatus(dispatch.status), DispatchStatus.ARRIVED)
        dispatch.status = DispatchStatus.ARRIVED
        dispatch.arrived_at = now
        dispatch.progress = 1.0
        assert_asset_transition(AssetStatus(asset.status), AssetStatus.ON_SCENE)
        asset.status = AssetStatus.ON_SCENE

    remaining_miles = max(0.0, remaining_miles)
    # A stopped asset has no ETA at all, and `None` says so. Zero would read as "arriving now",
    # which is the opposite of the truth and the sort of number a coordinator acts on.
    eta = 0.0 if arrived else (round((remaining_miles / asset.speed_mph) * 60.0, 1)
                               if asset.speed_mph > 0 else None)
    return {
        "dispatch_id": dispatch.id,
        "asset_id": asset.id,
        "incident_id": dispatch.incident_id,
        "call_sign": asset.call_sign,
        "kind": str(asset.kind),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "heading_deg": round(heading, 1),
        "heading": compass_point(heading),
        # The asset's own configured road speed, which is what the distance was divided by to get
        # the ETA. Reported rather than inferred so the widget's speed and its ETA cannot disagree.
        "speed_mph": round(float(asset.speed_mph or 0.0), 1),
        "progress": round(dispatch.progress, 4),
        "percent_complete": round(dispatch.progress * 100.0, 1),
        "route_miles": round(total_miles, 3),
        "travelled_miles": round(max(0.0, total_miles - remaining_miles), 3),
        "remaining_miles": round(remaining_miles, 3),
        "distance_remaining_miles": round(remaining_miles, 3),  # the tracker widget's own spelling
        "eta_minutes": eta,
        # The clock time the arithmetic above actually points at, so a tracker can count down
        # between ticks without inventing a rate of its own.
        "eta_at": ((now + timedelta(minutes=eta)).isoformat() + "Z") if eta is not None else None,
        "lights_on": running_lights(asset, dispatch, incident),
        "arrived": arrived,
        "at": now.isoformat() + "Z",
    }


def tick(session: Session, *, now: datetime | None = None) -> list[dict[str, Any]]:
    """One pass over everything in motion. Returns one change record per asset that moved."""
    now = now or utcnow()
    moving = session.exec(select(Dispatch).where(Dispatch.status == DispatchStatus.EN_ROUTE)).all()
    changes: list[dict[str, Any]] = []
    for dispatch in moving:
        asset = session.get(Asset, dispatch.asset_id)
        if asset is None:
            continue
        # Read before the move, not only on arrival: the light bar depends on the incident's
        # priority and has to be right on every tick, not just the last one. Within one session this
        # is an identity-map hit after the first tick, so it costs nothing per vehicle.
        incident = session.get(Incident, dispatch.incident_id)
        change = advance_dispatch(dispatch, asset, now=now, incident=incident)
        if change is None:
            continue
        session.add(dispatch)
        session.add(asset)
        if change["arrived"]:
            # First arrival puts the incident on scene; later arrivals do not move it backwards.
            if incident is not None and incident.status == IncidentStatus.DISPATCHED:
                incident.status = IncidentStatus.ON_SCENE
                session.add(incident)
            # Lights go out at the kerb: the unit has stopped, and `running_lights` already said so
            # by the time it was called, but state that plainly rather than leaving it to the client.
            change["lights_on"] = False
        changes.append(change)
    return changes


class MovementSimulator:
    """Owns the ticking. One per process; started with the app, stopped with it."""

    def __init__(
        self,
        session_factory: Callable[[], Any],
        *,
        tick_seconds: float = TICK_SECONDS,
        emit: Callable[[str, dict[str, Any]], None] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._tick_seconds = tick_seconds
        self._emit = emit
        self._task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if self.running:
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._loop(), name="buddye-movement")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None

    async def _loop(self) -> None:
        while not self._stopping.is_set():
            try:
                await asyncio.to_thread(self._tick_once)
            except Exception:  # noqa: BLE001
                # A simulation fault must never take the process down: the calls are the product,
                # the map is a view of them.
                log.exception("movement tick failed")
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=self._tick_seconds)
            except TimeoutError:
                pass

    def _tick_once(self) -> None:
        with self._session_factory() as session:
            changes = tick(session)
        for change in changes:
            if self._emit is not None:
                self._emit("asset.moved" if not change["arrived"] else "asset.arrived", change)


def emit_all(changes: Iterable[dict[str, Any]], emit: Callable[[str, dict[str, Any]], None]) -> None:
    for change in changes:
        emit("asset.arrived" if change["arrived"] else "asset.moved", change)
