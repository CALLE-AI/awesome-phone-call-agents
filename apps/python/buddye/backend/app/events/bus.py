"""DB-backed event log with in-process asyncio fanout.

Every sweep transition and every provider event is persisted as an AgentEvent row first, then pushed
to live SSE subscribers. Subscribers that reconnect replay from the table by id, so a dropped
connection mid-demo recovers instead of freezing.

The topic is the **hazard**, not the sweep: a captain watching the board during a heat warning wants
the triage, the calls, the escalations and a second sweep of the same block on one stream. `sweep_id`
and `neighbour_id` ride along on each event so a client can filter without a second subscription.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from sqlmodel import select

from app.db import session_scope
from app.models import AgentEvent


class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    def publish(
        self,
        *,
        hazard_id: str,
        sweep_id: str | None = None,
        neighbour_id: str | None = None,
        type: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with session_scope() as s:
            ev = AgentEvent(hazard_id=hazard_id, sweep_id=sweep_id, neighbour_id=neighbour_id, type=type, payload=payload or {})
            s.add(ev)
            s.flush()
            data = serialize(ev)
        for q in list(self._subs.get(hazard_id, ())) + list(self._subs.get("*", ())):
            q.put_nowait(data)
        return data

    def subscribe(self, hazard_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subs[hazard_id].add(q)
        return q

    def unsubscribe(self, hazard_id: str, q: asyncio.Queue) -> None:
        self._subs[hazard_id].discard(q)

    @staticmethod
    def replay(hazard_id: str, since_id: int = 0) -> list[dict[str, Any]]:
        with session_scope() as s:
            rows = s.exec(
                select(AgentEvent).where(AgentEvent.hazard_id == hazard_id, AgentEvent.id > since_id).order_by(AgentEvent.id)
            ).all()
            return [serialize(r) for r in rows]


def serialize(ev: AgentEvent) -> dict[str, Any]:
    return {
        "id": ev.id,
        "hazard_id": ev.hazard_id,
        "sweep_id": ev.sweep_id,
        "neighbour_id": ev.neighbour_id,
        "type": ev.type,
        "payload": ev.payload,
        "created_at": ev.created_at.isoformat() + "Z",
    }


bus = EventBus()
