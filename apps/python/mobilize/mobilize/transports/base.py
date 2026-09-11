"""Transport interface both the real CALL-E backend and the simulator implement.

The dispatcher, planner, and reconciler only ever talk to this interface, so
the entire evaluation harness runs at zero cost against `SimulatedTransport`
and the identical code path runs against `CalleTransport` for real calls.
"""

from __future__ import annotations

from typing import Protocol
from urllib.parse import urlparse

from mobilize.core.types import Candidate, CallResult
from mobilize.core.validation import E164_RE, validate_e164, validate_timezone

# CALL-E's real API host. Sending the bearer token to any other host would leak
# it, so CalleTransport refuses to talk to anything outside this allow-list.
TRUSTED_CALLE_HOSTS = {"api.heycall-e.com"}

__all__ = [
    "E164_RE", "validate_e164", "validate_timezone", "validate_trusted_base_url",
    "MOBILIZE_RESULT_SCHEMA", "build_task_prompt", "Transport",
]


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
    "required": ["can_come", "eta_minutes", "evidence_summary", "final_position"],
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
        # can_come reads any agreement in the call, even one the recipient
        # went on to take back -- it has no notion of what came LAST.
        # Several review rounds found real transcripts where an early "yes"
        # was withdrawn later in the same call using phrasing no
        # hand-written pattern list could keep up with ("I have to
        # cancel," "count me out," "I rescind my commitment," "that
        # agreement is off," ...). Recognizing that a statement retracts an
        # EARLIER one, in arbitrary phrasing, is a semantic judgment CALL-E's
        # own language understanding is positioned to make far better than
        # a regex ever will -- so this field asks for it directly, as the
        # recipient's position after weighing the WHOLE call, not a second
        # attempt to extract the same single-moment signal as can_come.
        # It is required and independently cross-checked against the
        # transcript before being trusted (see _to_call_result) -- this is
        # an additional signal, not a replacement for verifying the
        # conversation actually supports it.
        "final_position": {
            "type": "string",
            "enum": ["confirmed", "declined_or_withdrawn", "unclear"],
            "description": (
                "The recipient's position at the END of the call, after weighing the "
                "ENTIRE conversation, not just their first answer. If they agreed and "
                "then later changed their mind, cancelled, backed out, or said anything "
                "inconsistent with still coming -- in ANY wording, not just an obvious "
                "'no' -- use declined_or_withdrawn, even though they said yes earlier. "
                "Use confirmed only if their final, un-retracted position was a genuine "
                "agreement to come. Use unclear if the call never established a clear "
                "final position."
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
