from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import obs
from app import seed_assets as fleet_seed
from app.api import (
    assets,
    cases,
    demo,
    dispatch,
    escalations,
    hazards,
    incidents,
    neighbours,
    notifications,
    stream,
    trace,
    webhooks,
)
from app.api.local_only import LocalOnlyMiddleware
from app.calls.budget import count_real_calls
from app.calls.preflight import refresh_loop, validate_startup
from app.config import get_settings
from app.db import init_db, session_scope
from app.events.bus import bus
from app.models import Dispatch, Incident
from app.orchestrator import incidents as incident_layer
from app.orchestrator import runner
from app.seed_helpers import ensure_seeded, resumable_sweeps
from app.sim.movement import MovementSimulator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("buddye")


class MovementPublisher:
    """Turns the simulator's change records into hazard-scoped bus events.

    The simulator knows about dispatches and assets and deliberately nothing about hazards — it is
    the layer that would be replaced by a real AVL feed. The event bus is keyed by hazard, because
    that is what a captain has open. This is the join, and it caches dispatch -> hazard so a van
    moving every two seconds for ten minutes costs one lookup rather than three hundred.
    """

    def __init__(self) -> None:
        self._route: dict[str, tuple[str, str, str]] = {}  # dispatch_id -> (hazard, incident, neighbour)

    def _lookup(self, dispatch_id: str) -> tuple[str, str, str] | None:
        cached = self._route.get(dispatch_id)
        if cached is not None:
            return cached
        with session_scope() as s:
            dispatch = s.get(Dispatch, dispatch_id)
            if dispatch is None:
                return None
            incident = s.get(Incident, dispatch.incident_id)
            if incident is None:
                return None
            found = (incident.hazard_id, incident.id, incident.neighbour_id)
        self._route[dispatch_id] = found
        return found

    def __call__(self, type: str, change: dict[str, Any]) -> None:
        found = self._lookup(str(change.get("dispatch_id") or ""))
        if found is None:
            return
        hazard_id, incident_id, neighbour_id = found
        if change.get("arrived"):
            self._route.pop(str(change.get("dispatch_id") or ""), None)
        bus.publish(hazard_id=hazard_id, neighbour_id=neighbour_id, type=type,
                    payload=obs.redact({**change, "incident_id": incident_id}))


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    settings = get_settings()
    obs.install()  # redaction filter + structured CALL-E logging before anything can log
    problems = validate_startup(settings)
    if problems:
        for p in problems:
            log.error("startup check failed: %s", p)
        raise RuntimeError("BuddyE refused to start: " + "; ".join(problems))
    init_db()
    ensure_seeded(settings)
    with session_scope() as s:
        # Qualified on purpose: `app.seed` defines its own module-level `seed_assets` that plants
        # only the six community units, and a bare `from app.seed_assets import seed_assets` would
        # be shadowed by it. This is the superset — community plus the agency units a human has to
        # approve — and it is idempotent by call sign, so it never moves a van that is mid-dispatch.
        planted = fleet_seed.seed_assets(s)
    # A sweep left mid-roster by a restart is not abandoned: the driver re-attaches, finds the
    # CheckCall rows it already wrote, and carries on from the neighbour it had reached. The
    # alternative — starting again — would ring the first half of the block a second time.
    for sweep_id in resumable_sweeps():
        log.info("resuming sweep %s", sweep_id)
        runner.spawn(sweep_id)

    def _used() -> int:
        with session_scope() as s:
            return count_real_calls(s)

    status_task = asyncio.create_task(refresh_loop(settings, _used), name="calle-status-refresh")

    # The vehicle layer. `session_scope` is the factory rather than a bare Session because it
    # commits on exit — without that the simulator would advance positions in memory and throw them
    # away every tick, and a restart would put every van back at base.
    simulator = MovementSimulator(session_scope, tick_seconds=settings.MOVEMENT_TICK_S,
                                  emit=MovementPublisher())
    simulator.start()
    app.state.simulator = simulator

    # The console's ping feed. It writes no notifications of its own: it taps the bus the whole
    # system already publishes to, and for the handful of events worth interrupting a person for it
    # publishes the derived ping on the same call stack, so it reaches an open console over the SSE
    # connection that is already there. Installed after the simulator so an arrival on the very
    # first tick already has somewhere to go.
    untap = notifications.install()
    app.state.notifications_untap = untap

    # The operator layer's liveness path: reconcile escalations into incidents and, for community
    # resources only, get something rolling. Idempotent, so a missed pass costs seconds.
    sync_task = asyncio.create_task(
        incident_layer.sync_loop(interval_s=settings.INCIDENT_SYNC_S, auto_dispatch=settings.AUTO_DISPATCH),
        name="buddye-incident-sync",
    )
    app.state.sync_task = sync_task

    # Case calls hang off an inactive sweep, so the sweep resume above never reaches them. A case
    # call whose watcher died — a transient API timeout mid-poll, or this process restarting while
    # the phone rang — would otherwise sit at DIALING forever with the conversation already over.
    # This re-attaches through each call's own idempotency key: it reads the call, it never dials.
    # First pass runs as soon as startup finishes, then every 30 s.
    resume_task = asyncio.create_task(cases.resume_loop(settings), name="buddye-case-call-resume")
    app.state.resume_task = resume_task

    log.info(
        "BuddyE up. provider=%s budget=%s allowlist=%d numbers captain=%r contacts_callable=%s "
        "handoff_min_band=%s fleet=%d auto_dispatch=%s",
        settings.CALL_PROVIDER, settings.CALL_BUDGET_MAX, len(settings.dialable_numbers),
        settings.BLOCK_CAPTAIN_NAME, settings.CALL_EMERGENCY_CONTACTS, settings.HANDOFF_MIN_BAND,
        len(planted), settings.AUTO_DISPATCH,
    )
    yield
    resume_task.cancel()
    sync_task.cancel()
    untap()
    await simulator.stop()
    status_task.cancel()
    for t in runner.active_tasks().values():
        t.cancel()


app = FastAPI(title="BuddyE", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_methods=["*"], allow_headers=["*"])
# Added last, so it is the outermost layer: every request except a CALL-E webhook delivery is refused
# unless it comes from this machine, untunnelled. BuddyE is a local operator tool with no login, and
# these endpoints start real calls and return private records. See app/api/local_only.py.
app.add_middleware(LocalOnlyMiddleware)
for r in (
    hazards.router,
    hazards.sweeps_router,
    neighbours.router,
    cases.router,
    notifications.router,
    escalations.router,
    escalations.handoffs_router,
    incidents.router,
    incidents.documents_router,
    incidents.correspondence_router,
    assets.router,
    dispatch.router,
    stream.router,
    trace.router,
    webhooks.router,
    demo.router,
):
    app.include_router(r)
