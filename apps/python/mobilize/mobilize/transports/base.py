"""Transport interface both the real CALL-E backend and the simulator implement.

The dispatcher, planner, and reconciler only ever talk to this interface, so
the entire evaluation harness runs at zero cost against `SimulatedTransport`
and the identical code path runs against `CalleTransport` for real calls.
"""

from __future__ import annotations

from typing import Protocol

from mobilize.core.types import Candidate, CallResult

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
    },
    "additionalProperties": False,
}


def build_task_prompt(need_label: str, location: str) -> str:
    return (
        f"You are calling on behalf of {location} about an urgent request: {need_label}. "
        "Briefly and politely explain the request, ask whether the recipient can help "
        "right now, and if so ask when they can arrive. Identify yourself as an AI "
        "assistant at the start of the call. Keep the call under 60 seconds. If they "
        "decline or are unable to help, thank them and end the call."
    )


class Transport(Protocol):
    async def dispatch(self, candidate: Candidate, need_label: str, location: str) -> str:
        """Place a call, returning a call_id immediately (non-blocking)."""
        ...

    async def poll(self, call_id: str) -> CallResult | None:
        """Return the result if the call has reached a terminal state, else None."""
        ...
