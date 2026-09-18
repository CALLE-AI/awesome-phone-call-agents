"""Server-sent events per hazard, with replay from the event table on reconnect.

The topic is the hazard rather than the sweep, so a captain who opens the board mid-evening sees the
triage, the calls, the escalations and any second sweep of the same block on one connection. Every
event already carries `sweep_id` and `neighbour_id`, so a client filters without a second stream.

Replay is the part that earns its keep in a live demo: a laptop that sleeps, a Wi-Fi hiccup, or a
browser that decides to be clever reconnects with `since_event_id` and gets everything it missed
from the `AgentEvent` table, in order, instead of a board frozen at whatever was on screen.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query, Request
from sse_starlette.sse import EventSourceResponse

from app.events.bus import bus

router = APIRouter(prefix="/api/stream", tags=["stream"])


@router.get("/hazards/{hazard_id}")
async def stream_hazard(request: Request, hazard_id: str, since_event_id: int = Query(0, ge=0)):  # noqa: ANN201
    q = bus.subscribe(hazard_id)

    async def gen():  # noqa: ANN202
        try:
            last = since_event_id
            # Flush headers immediately: a client attaching to a finished sweep would otherwise see
            # no bytes until the first keepalive and its fetch() would not resolve. Comments are
            # ignored by every SSE parser.
            yield {"comment": f"ready last_event_id={last}"}
            for ev in bus.replay(hazard_id, since_event_id):
                last = max(last, int(ev["id"]))
                yield {"id": str(ev["id"]), "event": ev["type"], "data": json.dumps(ev)}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": json.dumps({"last_event_id": last})}
                    continue
                if int(ev["id"]) <= last:
                    continue
                last = int(ev["id"])
                yield {"id": str(ev["id"]), "event": ev["type"], "data": json.dumps(ev)}
        finally:
            bus.unsubscribe(hazard_id, q)

    return EventSourceResponse(gen(), ping=20)


@router.get("/hazards/{hazard_id}/history")
def history(hazard_id: str, since_event_id: int = Query(0, ge=0)) -> list[dict]:
    """The same events as the stream, as one JSON array. What a reconnecting client replays from."""
    return bus.replay(hazard_id, since_event_id)
