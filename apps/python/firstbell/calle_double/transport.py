"""Wire the double into the real CALL-E SDK.

`CalleClient` takes an injectable `httpx.Client`, and every request the SDK makes goes
through it. So an `httpx.MockTransport` pointed at the engine gives you a real
`CalleClient` object, exercising the real SDK code, that dials nobody.

Two behaviours of the SDK matter here, both learned by reading its source:

  1. When you inject a client, the SDK does not set `base_url` or the Authorization
     header. The injected client has to carry both.
  2. `wait_for_result` polls with `time.sleep`, so tests should pass
     `interval_seconds=0` unless they want to sit there.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .engine import CalleDouble, DoubleError

BASE_URL = "https://api.heycall-e.com"


def build_transport(double: CalleDouble) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        method = request.method
        try:
            if method == "POST" and path == "/v1/calls":
                body: dict[str, Any] = json.loads(request.content or b"{}")
                created = double.create_call(
                    task=body.get("task", ""),
                    recipients=body.get("recipients"),
                    result_schema=body.get("result_schema"),
                    recipient_result_schema=body.get("recipient_result_schema"),
                    metadata=body.get("metadata"),
                    webhook_url=body.get("webhook_url"),
                    idempotency_key=request.headers.get("idempotency-key"),
                )
                return httpx.Response(201, json=created)

            if method == "GET" and path.startswith("/v1/calls/"):
                rest = path[len("/v1/calls/"):]
                if rest.endswith("/events"):
                    call_id = rest[: -len("/events")]
                    limit = request.url.params.get("limit")
                    return httpx.Response(200, json=double.list_events(
                        call_id,
                        cursor=request.url.params.get("cursor"),
                        limit=int(limit) if limit else None,
                    ))
                return httpx.Response(200, json=double.get_call(rest))

            if method == "GET" and path == "/v1/goals":
                return httpx.Response(
                    200, json={"object": "list", "data": [], "next_cursor": None}
                )

        except DoubleError as err:
            return httpx.Response(err.status_code, json=err.body())

        return httpx.Response(
            404,
            json={"error": {"code": "not_found",
                            "message": f"No route for {method} {path}.",
                            "details": {}}},
        )

    return httpx.MockTransport(handler)


def build_client(double: CalleDouble, *, api_key: str = "iams_test_double"):
    """Return a real CalleClient backed by the double.

    Imported lazily so this module stays usable in environments where the SDK is not
    installed, which keeps the double useful as a standalone reference implementation.
    """
    from calle import CalleClient

    http = httpx.Client(
        transport=build_transport(double),
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {api_key}"},
    )
    return CalleClient(api_key=api_key, http_client=http)
