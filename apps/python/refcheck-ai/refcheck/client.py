"""Dispatching reference calls through the CALL-E Calls API."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from calle import CalleClient

from refcheck.schema import build_result_schema
from refcheck.task import build_reference_task


@lru_cache()
def get_client() -> CalleClient:
    """Server-side only. The API key must never reach a browser or a log."""
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "CALLE_API_KEY is not set. Create one at "
            "https://dashboard.heycall-e.com/account/api-keys"
        )
    return CalleClient(
        api_key=api_key,
        base_url=os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com"),
        timeout=30.0,
    )


def build_request(
    reference: dict[str, Any],
    candidate: dict[str, Any],
    questions: list[dict[str, Any]],
    *,
    webhook_url: str | None = None,
) -> dict[str, Any]:
    """The exact arguments that would be sent to `calls.create`.

    Split out from `place_call` so the preview path can show the request without
    a network call, and so tests can assert on it without mocking HTTP.
    """
    request: dict[str, Any] = {
        "task": build_reference_task(reference, candidate, questions),
        "recipient": {"phones": [reference["referee_phone"]]},
        "result_schema": build_result_schema(questions),
        "metadata": {
            "reference_id": str(reference["id"]),
            "candidate_id": str(candidate["id"]),
        },
        # Stable, not random: a retried dispatch must never place a second call
        # to the same referee.
        "idempotency_key": f"refcheck_ref_{reference['id']}",
    }
    if webhook_url:
        request["webhook_url"] = webhook_url
    return request


def place_call(
    reference: dict[str, Any],
    candidate: dict[str, Any],
    questions: list[dict[str, Any]],
    *,
    webhook_url: str | None = None,
) -> dict[str, Any]:
    """Create one call task. This dials a real phone.

    Returns the created call task; the terminal result arrives either by webhook
    (see refcheck/webhook.py) or by polling `wait_for_result`.
    """
    return get_client().calls.create(
        **build_request(reference, candidate, questions, webhook_url=webhook_url)
    )


def wait_for_result(call_id: str, *, timeout_seconds: float = 1200.0) -> dict[str, Any]:
    """Block until the call task reaches a terminal state.

    Prefer the webhook receiver for anything long-running: the Calls API has no
    client-side cancel, so a call already in flight runs to completion whether
    or not you are still waiting for it.
    """
    return get_client().calls.wait_for_result(
        call_id, interval_seconds=5.0, timeout_seconds=timeout_seconds
    )
