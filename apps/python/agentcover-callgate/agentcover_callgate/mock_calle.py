"""Offline CALL-E transport.

Builds a real httpx.Client backed by MockTransport so the official `calle-ai`
SDK runs its full request/response cycle — building the body, attaching the
Idempotency-Key header, POSTing to /v1/calls, then polling /v1/calls/{id} to a
terminal state — WITHOUT any network and WITHOUT placing a real call.

This is the honest verification path: the SDK is genuinely imported and called
at runtime; only the wire is faked. No call ID reaches a provider; no phone
rings.
"""
from __future__ import annotations

import json
import re
import uuid

import httpx


def _call_id() -> str:
    return "calle_" + uuid.uuid4().hex[:12]


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    method = request.method

    if method == "POST" and path == "/v1/calls":
        body = json.loads(request.content.decode())
        cid = _call_id()
        # Echo the idempotency key back so the SDK's header path is exercised.
        idem = request.headers.get("Idempotency-Key")
        return httpx.Response(
            200,
            json={
                "id": cid,
                "status": "completed",
                "task": body.get("task"),
                "recipients": body.get("recipients"),
                "structured_result": {
                    "completed_count": len(body.get("recipients", []) or []),
                    "outcome": "simulated_offline_no_call_placed",
                },
            },
            headers={"Idempotency-Key": idem} if idem else {},
        )

    if method == "GET" and re.fullmatch(r"/v1/calls/[^/]+", path):
        cid = path.rsplit("/", 1)[-1]
        return httpx.Response(
            200,
            json={"id": cid, "status": "completed"},
        )

    if method == "GET" and re.fullmatch(r"/v1/calls/[^/]+/events", path):
        return httpx.Response(200, json={"events": [], "cursor": None})

    return httpx.Response(404, json={"error": {"code": "not_found"}})


def offline_client() -> httpx.Client:
    return httpx.Client(
        base_url="https://api.heycall-e.com",
        transport=httpx.MockTransport(_handler),
    )
