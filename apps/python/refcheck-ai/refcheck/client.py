"""Dispatching reference calls through the CALL-E Calls API."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit

from calle import CalleClient

from refcheck.phone import assert_authorized, mask, normalize_e164
from refcheck.schema import build_result_schema
from refcheck.task import build_reference_task

# The only origin this app will send a bearer token to. `CALLE_BASE_URL` exists
# so a future official host can be selected, not so the endpoint can be pointed
# anywhere: an operator who can set one env var must not be able to redirect the
# API key to a host they control.
OFFICIAL_ORIGINS = frozenset({"https://api.heycall-e.com"})
DEFAULT_BASE_URL = "https://api.heycall-e.com"


class CredentialTargetError(ValueError):
    """The configured base URL is not an official CALL-E origin."""


def resolve_base_url(raw: str | None = None) -> str:
    """Return a base URL that is safe to attach a bearer token to.

    Rejects plaintext HTTP, embedded credentials, and any host outside
    `OFFICIAL_ORIGINS` — including look-alikes such as
    `https://api.heycall-e.com.evil.example`, which `str.startswith` would
    happily accept and a URL parser will not.
    """
    value = (raw if raw is not None else os.environ.get("CALLE_BASE_URL") or DEFAULT_BASE_URL).strip()
    parts = urlsplit(value)

    if parts.scheme != "https":
        raise CredentialTargetError(
            f"CALLE_BASE_URL must use https, got {parts.scheme or '(none)'!r}. "
            "Refusing to send the API key over plaintext."
        )
    if parts.username or parts.password:
        raise CredentialTargetError(
            "CALLE_BASE_URL must not embed credentials in the URL."
        )
    if parts.path.rstrip("/") or parts.query or parts.fragment:
        raise CredentialTargetError(
            "CALLE_BASE_URL must be a bare origin, with no path, query or fragment."
        )

    origin = f"{parts.scheme}://{parts.netloc}".rstrip("/")
    if origin not in OFFICIAL_ORIGINS:
        raise CredentialTargetError(
            f"Refusing to send CALL-E credentials to {origin!r}. "
            f"Allowed: {', '.join(sorted(OFFICIAL_ORIGINS))}."
        )
    return origin


@lru_cache()
def get_client() -> CalleClient:
    """Server-side only. The API key must never reach a browser or a log."""
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "CALLE_API_KEY is not set. Create one at "
            "https://dashboard.heycall-e.com/account/api-keys"
        )
    return CalleClient(api_key=api_key, base_url=resolve_base_url(), timeout=30.0)


def build_request(
    reference: dict[str, Any],
    candidate: dict[str, Any],
    questions: list[dict[str, Any]],
    *,
    webhook_url: str | None = None,
) -> dict[str, Any]:
    """The exact arguments that would be sent to `calls.create`.

    Split out from `place_call` so the preview path can show the request without
    a network call, and so tests can assert on it without mocking HTTP. The
    destination is validated here; operator authorization is checked only on the
    live path, because a preview dials nobody.
    """
    phone = normalize_e164(reference["referee_phone"])

    request: dict[str, Any] = {
        "task": build_reference_task(reference, candidate, questions),
        "recipient": {"phones": [phone]},
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

    The destination must be valid ASCII E.164 *and* present in
    `REFCHECK_ALLOWED_DESTINATIONS`, or `DestinationError` is raised and no call
    is placed.

    Returns the created call task; the terminal result arrives either by webhook
    (see refcheck/webhook.py) or by polling `wait_for_result`.
    """
    phone = assert_authorized(reference["referee_phone"])
    request = build_request(
        {**reference, "referee_phone": phone}, candidate, questions, webhook_url=webhook_url
    )
    return get_client().calls.create(**request)


def wait_for_result(call_id: str, *, timeout_seconds: float = 1200.0) -> dict[str, Any]:
    """Block until the call task reaches a terminal state.

    Prefer the webhook receiver for anything long-running: the Calls API has no
    client-side cancel, so a call already in flight runs to completion whether
    or not you are still waiting for it.
    """
    return get_client().calls.wait_for_result(
        call_id, interval_seconds=5.0, timeout_seconds=timeout_seconds
    )


__all__ = [
    "CredentialTargetError",
    "OFFICIAL_ORIGINS",
    "build_request",
    "get_client",
    "mask",
    "place_call",
    "resolve_base_url",
    "wait_for_result",
]
