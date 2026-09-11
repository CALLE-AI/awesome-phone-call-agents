"""Live-call destination and per-run intent authorization.

STORED_CONSENT_BOOLEAN alone is never sufficient for a live provider call.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

LIVE_CALL_ACTION = "live_call"

# ITU-T E.164: '+' then 1–15 digits (country code + subscriber number).
_E164_RE = re.compile(r"^\+[1-9]\d{1,14}$")


class LiveAuthorizationError(Exception):
    """Deterministic live-call authorization failure (fail closed)."""


@dataclass(frozen=True)
class LiveCallIntent:
    """Fresh per-run live-call authorization bound to run, destination, and action."""

    run_id: str
    authorized_destination_e164: str
    action: str = LIVE_CALL_ACTION

    def __post_init__(self) -> None:
        if not str(self.run_id or "").strip():
            raise LiveAuthorizationError("live intent run_id is required")
        assert_strict_e164(self.authorized_destination_e164)
        if self.action != LIVE_CALL_ACTION:
            raise LiveAuthorizationError(
                f"live intent action must be {LIVE_CALL_ACTION!r}"
            )


def assert_strict_e164(destination: str) -> str:
    """Accept only strict E.164. Never silently normalize ambiguous input."""
    if destination is None:
        raise LiveAuthorizationError("destination is required")
    if not isinstance(destination, str):
        raise LiveAuthorizationError("destination must be a string")
    if destination != destination.strip():
        raise LiveAuthorizationError("destination must not have leading/trailing whitespace")
    if any(ch.isspace() for ch in destination):
        raise LiveAuthorizationError("destination must not contain whitespace")
    if not destination.startswith("+"):
        raise LiveAuthorizationError("destination must begin with '+'")
    if any(ch in destination for ch in "-() .;/,"):
        raise LiveAuthorizationError("destination must not contain punctuation")
    if "ext" in destination.lower():
        raise LiveAuthorizationError("destination must not contain extensions")
    if not _E164_RE.match(destination):
        raise LiveAuthorizationError(
            "destination must be strict E.164 (+ then 1–15 digits, no formatting)"
        )
    return destination


def assert_exact_authorized_destination(
    *,
    destination: str,
    authorized_destination: str,
) -> None:
    assert_strict_e164(destination)
    assert_strict_e164(authorized_destination)
    if destination != authorized_destination:
        raise LiveAuthorizationError(
            "destination does not exactly match authorized destination"
        )


def assert_live_call_authorized(
    *,
    destination: str,
    consent_confirmed: bool,
    live_intent: LiveCallIntent | None,
    expected_run_id: str | None = None,
) -> LiveCallIntent:
    """Gate every live provider call. Consent alone is never enough."""
    if not consent_confirmed:
        raise LiveAuthorizationError("consent_confirmed must be true")
    if live_intent is None:
        raise LiveAuthorizationError(
            "fresh per-run LiveCallIntent required; stored consent is insufficient"
        )
    assert_strict_e164(destination)
    assert_exact_authorized_destination(
        destination=destination,
        authorized_destination=live_intent.authorized_destination_e164,
    )
    if live_intent.action != LIVE_CALL_ACTION:
        raise LiveAuthorizationError("live intent action mismatch")
    if expected_run_id is not None and live_intent.run_id != expected_run_id:
        raise LiveAuthorizationError("live intent run_id mismatch")
    return live_intent
