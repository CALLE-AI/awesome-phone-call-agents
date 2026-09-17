"""Demo glue around `app.seed`.

`app.seed` owns the roster, the fleet and the two hazard specs. This module owns what has to happen
*around* a reset in a running process: stopping drivers that are mid-sweep, wiping, re-seeding, and
announcing the new hazard on the event bus so a browser already watching sees the board come back
rather than sitting on a stream for a hazard that no longer exists.

Kept out of `app/api/demo.py` so that the startup path (`main.py`) and the reset endpoint run the
same code. A demo that behaves differently on a fresh boot than on a reset is a demo that fails in
front of an audience for reasons nobody can reproduce afterwards.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any

from sqlmodel import select

from app.config import Settings
from app.db import session_scope
from app.events.bus import bus
from app.models import Hazard, Neighbour, Sweep
from app.seed import declare_outage as _declare_outage
from app.seed import seed

log = logging.getLogger("buddye.seed")


def stop_active_drivers() -> list[str]:
    """Cancel every in-flight sweep driver. Returns the sweep ids that were running.

    A reset wipes the tables those coroutines are reading; leaving them running means a driver
    writing a CheckCall for a neighbour who no longer exists.
    """
    from app.orchestrator import runner

    stopped = []
    for sweep_id, task in runner.active_tasks().items():
        task.cancel()
        stopped.append(sweep_id)
    return stopped


def reset_demo(settings: Settings) -> dict[str, Any]:
    """Wipe and re-seed. Returns the ids the UI needs to reattach.

    `SpentCall` survives — see `app.seed.wipe`. The free tier is 20 real calls for the life of the
    account, and a reset button that handed them back would let the next demo spend them again.
    """
    stopped = stop_active_drivers()
    with session_scope() as s:
        hazard = seed(s, settings)
        hazard_id, headline, kind = hazard.id, hazard.headline, hazard.kind
        neighbours = len(list(s.exec(select(Neighbour)).all()))
    bus.publish(hazard_id=hazard_id, type="demo.reset",
                payload={"headline": headline, "kind": kind, "neighbours": neighbours, "sweeps_cancelled": stopped})
    log.info("demo reset: hazard=%s neighbours=%d cancelled=%d", hazard_id, neighbours, len(stopped))
    return {"ok": True, "hazard_id": hazard_id, "kind": kind, "headline": headline,
            "neighbours": neighbours, "sweeps_cancelled": stopped}


def declare_outage(*, today: date | None = None) -> dict[str, Any]:
    """The demo's second hazard, declared live over the same roster.

    This is the moment worth watching: the same fourteen people, re-scored against a power cut, and
    Walter — who barely registered under a heat warning — comes out first because his concentrator
    runs on wall power. Idempotent by kind, so a second press returns the outage already on the board.
    """
    with session_scope() as s:
        hazard = _declare_outage(s, today=today)
        payload = {"hazard_id": hazard.id, "kind": hazard.kind, "headline": hazard.headline,
                   "severity": hazard.severity, "facts": dict(hazard.facts or {})}
    bus.publish(hazard_id=payload["hazard_id"], type="hazard.declared", payload=payload)
    return payload


def ensure_seeded(settings: Settings) -> str | None:
    """Seed an empty database on startup. Returns the hazard id if it planted one."""
    with session_scope() as s:
        if s.exec(select(Neighbour)).first() is not None:
            return None
        hazard = seed(s, settings)
        return hazard.id


def resumable_sweeps() -> list[str]:
    """Sweeps left non-terminal by a restart, oldest first — `main.py` re-attaches a driver to each."""
    with session_scope() as s:
        rows = s.exec(select(Sweep).where(Sweep.is_active == True).order_by(Sweep.created_at)).all()  # noqa: E712
        return [r.id for r in rows]


def open_hazards() -> list[Hazard]:
    with session_scope() as s:
        rows = list(s.exec(select(Hazard).where(Hazard.status != "CLOSED")).all())
        for r in rows:
            s.expunge(r)
        return rows
