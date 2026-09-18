"""Webhook deliveries are transport hints. The GET is the truth.

CALL-E webhook deliveries are **not signed**. A delivery therefore never
carries authority in this workflow: the only values read from a payload are
the event name and the call id, and the only permitted follow-up is one
authoritative ``calls.get`` against that id. Whatever the GET returns
decides; a hint that disagrees with the GET loses, a hint that cannot be
reconciled changes nothing, and no path exists from a webhook payload to a
business fact, a state transition, or a write-back.

The proof path uses the replayed fixtures under ``fixtures/webhooks/`` —
no public endpoint, no tunnel, no listener. This module is a pure function
pair: parse a delivery into a hint, then reconcile the hint against an
injected GET.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Optional

__all__ = [
    "WEBHOOK_TERMINAL_EVENTS",
    "HintResult",
    "reconcile_hint",
    "webhook_hint",
]

#: The terminal events the platform delivers. Anything else is not a hint
#: this workflow acts on — recorded, ignored.
WEBHOOK_TERMINAL_EVENTS = frozenset(
    {"call.completed", "call.failed", "call.result_validation_failed"}
)

#: A GET seam: returns the authoritative call payload, or raises like the
#: SDK would. Injected so tests and the proof path never touch a network.
Getter = Callable[[str], Mapping[str, Any]]


class HintResult(dict[str, Any]):
    """The parse result of one delivery (a plain dict, named for readers)."""


def webhook_hint(payload: Any) -> HintResult:
    """Reduce a delivery to (event, call id) — the only values ever read.

    Unsigned input is untrusted input: a missing or malformed event name or
    call id, or an event outside the terminal set, yields an ignored hint
    with the reason recorded. Nothing else in the payload is examined, so
    nothing else in it can matter.
    """

    if not isinstance(payload, Mapping):
        return HintResult(
            {"ignored": True, "reason": "PAYLOAD_NOT_AN_OBJECT",
             "event": None, "call_id": None}
        )
    event = payload.get("event") or payload.get("type")
    call_id = payload.get("call_id")
    if not isinstance(event, str) or event not in WEBHOOK_TERMINAL_EVENTS:
        return HintResult(
            {"ignored": True, "reason": "EVENT_NOT_TERMINAL_OR_UNKNOWN",
             "event": event if isinstance(event, str) else None,
             "call_id": None}
        )
    if not isinstance(call_id, str) or not call_id.strip():
        return HintResult(
            {"ignored": True, "reason": "NO_CALL_ID", "event": event,
             "call_id": None}
        )
    return HintResult(
        {"ignored": False, "reason": None, "event": event, "call_id": call_id}
    )


def reconcile_hint(hint: Mapping[str, Any], getter: Getter) -> dict[str, Any]:
    """One authoritative GET decides. The hint never does.

    The GET result is classified through the same transport vocabulary the
    adapter uses. A hint that agrees with the GET records agreement; a hint
    that contradicts it records the contradiction and the GET stands; a GET
    that fails leaves the attempt exactly as uncertain as it was — the hint
    fills no gaps. Duplicate hints reconcile identically and write nothing.
    """

    if hint.get("ignored"):
        return {
            "hint": dict(hint),
            "authoritative": None,
            "outcome": "HINT_IGNORED",
            "reason": hint.get("reason"),
        }
    call_id = hint.get("call_id")
    if not isinstance(call_id, str):
        return {
            "hint": dict(hint),
            "authoritative": None,
            "outcome": "HINT_IGNORED",
            "reason": "NO_CALL_ID",
        }
    try:
        payload = getter(call_id)
    except Exception as error:
        return {
            "hint": dict(hint),
            "authoritative": None,
            "outcome": "GET_FAILED",
            "reason": type(error).__name__,
        }
    status = payload.get("status") if isinstance(payload, Mapping) else None
    terminal = status in ("completed", "failed", "canceled")
    return {
        "hint": dict(hint),
        "authoritative": {
            "call_id": call_id,
            "status": status,
            "terminal": terminal,
        },
        "outcome": "RECONCILED",
        "agreement": _agrees_with_hint(hint.get("event"), status),
    }


def _agrees_with_hint(
    event: Optional[str], status: Optional[str]
) -> Optional[bool]:
    """Whether the terminal event a hint announced matches the GET record."""

    expected = {
        "call.completed": "completed",
        "call.failed": "failed",
        "call.result_validation_failed": "completed",
    }
    if not isinstance(event, str) or event not in expected:
        return None
    if not isinstance(status, str):
        return None
    return status == expected[event]
