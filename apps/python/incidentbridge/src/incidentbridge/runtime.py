"""Thin adapter around the official CALL-E Python SDK."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol
from urllib.parse import urlparse

from incidentbridge.models import IncidentRequest
from incidentbridge.policy import call_arguments, idempotency_key, redact, route_result

DEFAULT_BASE_URL = "https://api.heycall-e.com"


class CallsAPI(Protocol):
    def create(self, **kwargs: Any) -> dict[str, Any]: ...

    def wait_for_result(
        self, call_id: str, *, timeout_seconds: int, interval_seconds: int
    ) -> dict[str, Any]: ...


def validate_base_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "api.heycall-e.com"
        and parsed.port in {None, 443}
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    ):
        return DEFAULT_BASE_URL
    if (
        parsed.scheme == "http"
        and parsed.hostname in {"127.0.0.1", "localhost"}
        and parsed.port is not None
        and parsed.path in {"", "/"}
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    ):
        return value.rstrip("/")
    raise ValueError(
        "CALLE_BASE_URL must be the official HTTPS origin; plain HTTP is allowed only "
        "for an exact loopback test server with an explicit port"
    )


def execute(
    request: IncidentRequest,
    calls: CallsAPI,
    timeout_seconds: int,
    on_created: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    created = calls.create(
        **call_arguments(request), idempotency_key=idempotency_key(request)
    )
    call_id = created.get("id")
    if not isinstance(call_id, str) or not call_id:
        raise RuntimeError("CALL-E create response did not contain a call id")
    if on_created is not None:
        on_created(call_id)
    completed = calls.wait_for_result(
        call_id, timeout_seconds=timeout_seconds, interval_seconds=2
    )
    structured = completed.get("structured_result")
    if structured is not None and not isinstance(structured, dict):
        raise RuntimeError("CALL-E structured_result was not an object")
    return {
        "mode": "execute",
        "creates_phone_call": True,
        "call_id": call_id,
        "idempotency_key": idempotency_key(request),
        "status": completed.get("status"),
        "task_completed": completed.get("task_completed"),
        "completion_confidence": completed.get("completion_confidence"),
        "structured_result": redact(structured),
        "decision": route_result(
            structured,
            provider_status=completed.get("status"),
            task_completed=completed.get("task_completed"),
            completion_confidence=completed.get("completion_confidence"),
        ),
    }
