"""Inline fake MCP server module (canonical name).

This module is the **default mode** of the ParcelBridge
reference app. It implements
:class:`InlineFakeMcpServer`, an in-process stand-in for the
upstream SDK's MCP envelope. The server materialises a
canned ``plan_call`` response without contacting any network
endpoint and without ever exposing a real capability value.

The synthesis is deliberately incomplete — there is no
``display_goal``, no ``confirm_summary``, no
``clarifying_questions`` text — so that any downstream
"business semantics" claim is explicitly :data:`UNVERIFIED`
rather than over-claimed.

The canonical home of this module is
:mod:`parcelbridge.fake_mcp`. The older
:mod:`parcelbridge.offline` module is a thin re-export shim
kept for backwards compatibility with the original
prototype's import path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from parcelbridge.payload import BusinessPayload
from parcelbridge.sanitization import (
    SanitizedResponse,
    sanitize_plan_response,
)


# Canary length chosen so it is identifiable as "this came
# from the inline fake MCP server". It is **not** a real
# token value; it is merely the length of the placeholder
# string the synthetic server produced. The string itself
# is a deliberately recognisable placeholder; the
# sanitizer's length-fingerprint walk reduces it to a
# single integer without ever surfacing the value.
_OFFLINE_CANARY_LENGTH = 37
_OFFLINE_CANARY_PLACEHOLDER = "offline-mode-canary-placeholder-token"


@dataclass(frozen=True)
class FakeMcpPlanCallResult:
    """Result of an inline fake MCP plan-call invocation.

    Attributes
    ----------
    sanitized_response:
        The redacted response from the inline fake server.
    bridge_mode:
        Always ``"offline"``.
    outcome:
        ``"PASS_WITH_LIMITATION"`` for the offline mode.
        The limitation is that the synthetic server does
        not populate plan text fields; any downstream
        claim that the response carries business content
        is therefore :data:`UNVERIFIED`.
    """

    sanitized_response: SanitizedResponse
    bridge_mode: str
    outcome: str


class InlineFakeMcpServer:
    """In-process stand-in for an MCP server.

    The class wraps a single canned response shape. The
    server is **stateful** in the sense that it records
    the call count, but it never reads from disk, never
    opens a socket, and never spawns a subprocess. A real
    integration would subclass this and override
    :meth:`call_plan` to delegate to the upstream SDK.
    """

    bridge_mode: str = "offline"

    def __init__(self) -> None:
        self.call_count: int = 0
        self.last_scenario: str | None = None

    def call_plan(self, payload: BusinessPayload) -> Dict[str, Any]:
        """Return the canned plan_call response shape."""

        self.call_count += 1
        self.last_scenario = payload.scenario
        return _synthetic_plan_response(payload)

    def reset(self) -> None:
        """Reset the server's call counter. Used by tests."""

        self.call_count = 0
        self.last_scenario = None


def _synthetic_plan_response(payload: BusinessPayload) -> Dict[str, Any]:
    """Construct the canned offline response shape.

    The response deliberately has empty ``display_goal``,
    ``confirm_summary``, and ``clarifying_questions`` fields.
    The shape is preserved (so the sanitizer can walk it) but
    the business text is absent (so the sanitizer reports
    :data:`UNVERIFIED` for any business-content flag).

    The ``capability_values`` sub-mapping carries a placeholder
    string of length :data:`_OFFLINE_CANARY_LENGTH` rather than
    an integer length field. The string is a recognisable
    non-secret placeholder; the sanitizer will reduce it to a
    length-only fingerprint so that the placeholder value never
    reaches the caller.
    """

    return {
        "ready_to_run": True,
        "bridge_mode": "offline",
        "scenario": payload.scenario,
        "capability_values": {
            "confirm_token": _OFFLINE_CANARY_PLACEHOLDER,
            "plan_id": _OFFLINE_CANARY_PLACEHOLDER,
        },
        "display_goal": "",
        "confirm_summary": "",
        "clarifying_questions": [],
        "request_meta": {
            "scenario": payload.scenario,
            "language": payload.language,
            "region": payload.region,
        },
    }


def run_fake_mcp_plan_call(
    payload: BusinessPayload,
    server: InlineFakeMcpServer | None = None,
) -> FakeMcpPlanCallResult:
    """Run a plan-call against the inline fake MCP server.

    This function does not contact any network. It does not
    read any phone number, OAuth token, or live credential.
    The capability values are returned only as length
    fingerprints.

    Parameters
    ----------
    payload:
        A pre-validated :class:`BusinessPayload`.
    server:
        Optional pre-built :class:`InlineFakeMcpServer`
        instance. If omitted, a new instance is constructed
        for this call.

    Returns
    -------
    FakeMcpPlanCallResult
        The sanitized response, the bridge mode, and the
        outcome label.
    """

    if server is None:
        server = InlineFakeMcpServer()

    raw_response = server.call_plan(payload)
    sanitized = sanitize_plan_response(raw_response)

    # Canary check: the synthetic server's placeholder
    # value has a length of ``_OFFLINE_CANARY_LENGTH``.
    # After the sanitizer has walked the response, the
    # placeholder value has been reduced to a length-only
    # fingerprint. Verify the fingerprint matches the
    # canary. If they disagree, the inline server has been
    # corrupted and we fail closed.
    observed_length = sanitized.fingerprints.get("confirm_token")
    if observed_length != _OFFLINE_CANARY_LENGTH:
        raise RuntimeError(
            f"fake-MCP canary length mismatch: observed={observed_length!r}, "
            f"expected={_OFFLINE_CANARY_LENGTH!r}; refusing to return a "
            f"result that may have been tampered with."
        )

    return FakeMcpPlanCallResult(
        sanitized_response=sanitized,
        bridge_mode="offline",
        outcome="PASS_WITH_LIMITATION",
    )


__all__ = [
    "InlineFakeMcpServer",
    "FakeMcpPlanCallResult",
    "run_fake_mcp_plan_call",
]