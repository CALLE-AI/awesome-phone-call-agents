"""Test plumbing: build a mock provider with edited fixtures, run a sweep, read the result back.

`fixtures_with` is the one with a trap in it. `app.calls.mock.FIXTURES` is keyed by **person name**
(not id), each value holds a nested `result` and an optional `by_hazard` overlay, and `checks` is a
dict inside `result` that must merge key-by-key — "everything as scripted except her power is off"
has to be sayable in one line, or every test that wants one different answer ends up restating a
whole conversation. Copies are deep, so a test that edits Rosa cannot leak into the next test.
"""
from __future__ import annotations

import copy
from typing import Any

from sqlmodel import select

from app.calls.mock import FIXTURES, MockCallProvider
from app.config import Settings, get_settings
from app.db import session_scope
from app.models import CheckCall, Escalation, HandoffPacket, Hazard, Neighbour, Sweep


def fixtures_with(overrides: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """A copy of the fixture set with per-person edits applied.

    `{"Rosa Delgado": {"status": "NO_ANSWER", "result": None}}` makes Rosa's phone ring out.
    `{"Benny Okonkwo": {"result": {"checks": {"has_power": "no"}}}}` changes one answer and leaves
    the rest of his conversation exactly as scripted.
    """
    fx = copy.deepcopy(FIXTURES)
    for name, patch in overrides.items():
        base = fx.setdefault(name, {"status": "COMPLETED", "result": {}, "transcript": [], "summary": "", "duration_s": 10})
        for key, value in patch.items():
            if key == "result" and isinstance(value, dict) and isinstance(base.get("result"), dict):
                checks = {**(base["result"].get("checks") or {}), **(value.get("checks") or {})}
                base["result"] = {**base["result"], **value}
                if checks:
                    base["result"]["checks"] = checks
            else:
                base[key] = value
    return fx


def mock(overrides: dict[str, dict[str, Any]] | None = None) -> MockCallProvider:
    """A zero-delay mock provider. `name_lookup` is wired so a call still finds its fixture even if
    the runner ever stops putting `neighbour_name` in the metadata — without it a silent fallback to
    DEFAULT_FIXTURE would give thirteen identical conversations and green tests."""

    def lookup(neighbour_id: str) -> str:
        with session_scope() as s:
            nbr = s.get(Neighbour, neighbour_id)
            return nbr.name if nbr else ""

    return MockCallProvider(delay_s=0, fixtures=fixtures_with(overrides or {}), name_lookup=lookup)


def settings_with(**overrides: Any) -> Settings:
    return get_settings().model_copy(update=overrides)


# ------------------------------------------------------------------------------------------------
def make_sweep(hazard_id: str, *, provider: str = "mock") -> str:
    """Create the sweep row the way the API does, without spawning a driver."""
    from app.orchestrator.sweep import open_sweep

    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        assert hazard is not None
        sweep, _ = open_sweep(s, hazard, provider=provider)
        s.flush()
        return sweep.id


async def run_sweep(hazard_id: str, *, provider: MockCallProvider | None = None,
                    settings: Settings | None = None, sweep_id: str | None = None) -> str:
    """Run one sweep to completion in-process and return its id."""
    from app.orchestrator.reconcile import NullReconciler
    from app.orchestrator.runner import Runner

    sweep_id = sweep_id or make_sweep(hazard_id)
    runner = Runner(
        sweep_id,
        settings=settings or get_settings(),
        provider=provider or mock(),
        # No network in tests. The reconciler is exercised in tests/test_reconcile_glm.py.
        reconciler=NullReconciler(),
    )
    await runner.run()
    return sweep_id


# ------------------------------------------------------------------------------------------------
def get_sweep(sweep_id: str) -> Sweep:
    with session_scope() as s:
        sweep = s.get(Sweep, sweep_id)
        assert sweep is not None
        s.expunge(sweep)
        return sweep


def outcomes_by_name(sweep_id: str) -> dict[str, str]:
    with session_scope() as s:
        sweep = s.get(Sweep, sweep_id)
        assert sweep is not None
        names = {n.id: n.name for n in s.exec(select(Neighbour)).all()}
        return {names.get(k, k): v for k, v in (sweep.outcomes or {}).items()}


def calls_of(sweep_id: str, *, callee: str | None = None) -> list[CheckCall]:
    with session_scope() as s:
        q = select(CheckCall).where(CheckCall.sweep_id == sweep_id)
        if callee:
            q = q.where(CheckCall.callee == callee)
        rows = list(s.exec(q.order_by(CheckCall.started_at)).all())  # type: ignore[arg-type]
        for r in rows:
            s.expunge(r)
        return rows


def escalations_of(sweep_id: str) -> list[Escalation]:
    with session_scope() as s:
        rows = list(s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id).order_by(Escalation.created_at)).all())
        for r in rows:
            s.expunge(r)
        return rows


def packets_of(sweep_id: str) -> list[HandoffPacket]:
    ids = [e.id for e in escalations_of(sweep_id)] or [""]
    with session_scope() as s:
        rows = list(s.exec(select(HandoffPacket).where(HandoffPacket.escalation_id.in_(ids))).all())  # type: ignore[attr-defined]
        for r in rows:
            s.expunge(r)
        return rows


def neighbour_named(name: str) -> Neighbour:
    with session_scope() as s:
        nbr = s.exec(select(Neighbour).where(Neighbour.name == name)).first()
        assert nbr is not None, f"no seeded neighbour called {name!r}"
        s.expunge(nbr)
        return nbr


def events_of(hazard_id: str, *, type: str | None = None) -> list[dict[str, Any]]:
    from app.events.bus import bus

    rows = bus.replay(hazard_id, 0)
    return [e for e in rows if type is None or e["type"] == type]
