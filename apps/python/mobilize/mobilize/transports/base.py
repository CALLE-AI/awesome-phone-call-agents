"""Transport interface both the real CALL-E backend and the simulator implement.

The dispatcher, planner, and reconciler only ever talk to this interface, so
the entire evaluation harness runs at zero cost against `SimulatedTransport`
and the identical code path runs against `CalleTransport` for real calls.
"""

from __future__ import annotations

import re
from typing import Protocol
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from mobilize.core.types import Candidate, CallResult

# Same pattern CALL-E's own OpenAPI spec uses for CallTaskRecipientRequest.phones.
E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")

# CALL-E's real API host. Sending the bearer token to any other host would leak
# it, so CalleTransport refuses to talk to anything outside this allow-list.
TRUSTED_CALLE_HOSTS = {"api.heycall-e.com"}


def validate_e164(phone: str) -> None:
    if not E164_RE.match(phone):
        raise ValueError(f"Phone number is not valid E.164: {phone!r}")


def validate_timezone(tz: str) -> None:
    """Real calls must carry an explicit, real recipient timezone -- without
    this, Candidate.timezone silently defaults to "UTC" and the governance
    module's calling-hours check evaluates every recipient against the
    wrong clock, exactly as if the check didn't exist."""
    try:
        ZoneInfo(tz)
    except ZoneInfoNotFoundError:
        raise ValueError(f"Not a recognized IANA timezone name: {tz!r}") from None


def validate_trusted_base_url(base_url: str) -> None:
    parsed = urlparse(base_url)
    if parsed.scheme != "https":
        raise ValueError(f"CALLE_BASE_URL must use https, got: {base_url!r}")
    if parsed.hostname not in TRUSTED_CALLE_HOSTS:
        raise ValueError(
            f"CALLE_BASE_URL host {parsed.hostname!r} is not in the trusted "
            f"host allow-list {TRUSTED_CALLE_HOSTS}. Refusing to send the "
            f"CALL-E bearer token to an untrusted host."
        )

MOBILIZE_RESULT_SCHEMA = {
    "type": "object",
    "required": ["can_come", "eta_minutes", "evidence_summary"],
    "properties": {
        "can_come": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Use yes only if the recipient clearly agreed to come. Use no if they "
                "declined or are ineligible. Use unknown if the call did not reach them "
                "or the answer was unclear."
            ),
        },
        "eta_minutes": {
            "type": "string",
            "description": (
                "Recipient's stated arrival time in minutes as a string (e.g. '15'), "
                "or 'unknown' if not stated."
            ),
        },
        "evidence_summary": {
            "type": "string",
            "description": (
                "One sentence quoting or closely paraphrasing the recipient's own words "
                "about their commitment, verbatim where possible. This is used to score "
                "how firm the commitment is, so preserve hedging language "
                "('I'll try', 'maybe') and firm language ('leaving now') exactly."
            ),
        },
        "wants_no_further_contact": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "Use yes ONLY if the recipient explicitly asked not to be contacted "
                "again, to be removed from the list, to stop calling them, or similar "
                "unambiguous opt-out language -- not merely declining this one request. "
                "Use no if they did not say anything like this. Use unknown if the call "
                "did not reach them clearly enough to tell. This is treated as a "
                "permanent do-not-call request and acted on immediately, so only use "
                "yes when the recipient's own words genuinely support it."
            ),
        },
    },
    "additionalProperties": False,
}


def build_task_prompt(need_label: str, location: str) -> str:
    return (
        f"You are calling on behalf of {location} about an urgent request: {need_label}. "
        "Briefly and politely explain the request, ask whether the recipient can help "
        "right now, and if so ask when they can arrive. Identify yourself as an AI "
        "assistant at the start of the call. Keep the call under 60 seconds. If they "
        "decline or are unable to help, thank them and end the call. If the recipient "
        "explicitly asks not to be contacted again or to be removed from the list, "
        "acknowledge that clearly and make sure it is captured -- this request will be "
        "honored permanently and immediately."
    )


class Transport(Protocol):
    async def dispatch(self, candidate: Candidate, need_label: str, location: str, *, idempotency_key: str) -> str:
        """Place a call, returning a call_id immediately (non-blocking).

        `idempotency_key` is precomputed by the caller from the ledger
        (mobilization_id + candidate_id) and must be threaded through to the
        real CALL-E API's own Idempotency-Key header. That's what makes a
        crash between the provider accepting the call and the ledger write
        completing safe: a retry on restart reuses the identical key, so
        CALL-E returns the same call rather than placing a second one --
        durability from an idempotent downstream, not from write ordering
        alone.
        """
        ...

    async def poll(self, call_id: str, *, expected_candidate: Candidate | None = None) -> CallResult | None:
        """Return the result if the call has reached a terminal state, else None.

        `expected_candidate` lets the caller supply binding context the
        transport may not have itself -- CalleTransport's own dispatch-time
        cache is in-memory and empty after a process restart, so without
        this, result-binding validation would silently stop happening
        during exactly the crash-recovery path it matters most for.
        """
        ...
