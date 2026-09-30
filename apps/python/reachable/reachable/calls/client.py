"""The call transport interface, and the shapes that cross it.

Three implementations: :mod:`dryrun_client` (renders, never dials),
:mod:`calle_client` (the real SDK), and the in-process fake used by tests.

Submission outcomes are deliberately three-valued. A client timeout tells you
about your client, not about the recipient's telephone: the call may already
have been placed, so it becomes *unknown* and is reconciled by reading the call
back -- never by dialling again.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


class CallError(RuntimeError):
    """A definite failure to submit. No call was accepted."""


class CallSubmissionUnknown(RuntimeError):
    """The request left the client and its fate is unknown.

    The call may already have happened. The only safe response is to reconcile
    with ``GET /v1/calls/{call_id}``.
    """


@dataclass(frozen=True)
class CallRequest:
    """One authorised call, fully rendered, with its reserved key."""

    task: str
    result_schema: dict[str, Any]
    destination: str
    idempotency_key: str
    #: Echoed by CALL-E on the call and on webhooks; the binding check reads it.
    metadata: dict[str, Any] = field(default_factory=dict)
    region: str = "GB"
    locale: str = "en-GB"

    def masked(self) -> str:
        from ..phone import mask

        return mask(self.destination)


@dataclass(frozen=True)
class CallHandle:
    """What came back from submission. The call id is stored before any wait."""

    call_id: str
    status: str


class CallClient(Protocol):
    """Every transport implements exactly this."""

    def create(self, request: CallRequest) -> CallHandle:
        """Submit one call. Raises CallError or CallSubmissionUnknown."""
        ...

    def get(self, call_id: str) -> dict[str, Any]:
        """Read one call back. The authoritative snapshot."""
        ...


def call_task(
    call_id: str,
    *,
    status: str = "completed",
    task: str = "",
    metadata: dict[str, Any] | None = None,
    structured_result: Any = None,
    task_completed: bool | None = True,
    score: float | None = 0.9,
    label: str | None = "high",
    summary: str | None = "",
    evidence: list[str] | None = None,
    failure_code: str | None = None,
    failure_message: str | None = None,
    destination: str = "+447700900123",
    transcript_turns: list[dict[str, Any]] | None = None,
    recipient_status: str = "completed",
) -> dict[str, Any]:
    """Build a CallTask with every required field, in the OpenAPI 0.7.0 shape.

    Transcript turns are nested at ``recipients[].attempts[].transcript_turns``,
    which is where the contract puts them -- **not** at the top level, and not in
    the older flat shape some fixtures elsewhere still use. Writing the fake to
    the contract rather than to a fixture is what stops binding code from
    passing in tests and failing in production.
    """
    confidence: dict[str, Any] | None = None
    if score is not None or label is not None:
        confidence = {"score": score, "label": label}
    return {
        "id": call_id,
        "object": "call_task",
        "status": status,
        "task": task,
        "recipients": [
            {
                "id": "rcp_1",
                "phones": [destination],
                "locale": "en-GB",
                "region": "GB",
                "status": recipient_status,
                "structured_result": None,
                "summary": summary,
                "attempts": [
                    {
                        "id": "att_1",
                        "phone": destination,
                        "status": (
                            "completed" if status == "completed" else status
                        ),
                        "started_at": "2026-09-11T09:30:00Z",
                        "completed_at": (
                            "2026-09-11T09:31:00Z"
                            if status in {"completed", "failed", "canceled"}
                            else None
                        ),
                        "summary": summary,
                        "transcript_turns": list(transcript_turns or []),
                        "provider_call_id": "provider_1",
                        "failure_code": failure_code,
                        "failure_message": failure_message,
                    }
                ],
            }
        ],
        "structured_result": structured_result,
        "summary": summary,
        "task_completed": task_completed,
        "completion_confidence": confidence,
        "evidence": list(evidence or []),
        "metadata": dict(metadata or {}),
        "failure_code": failure_code,
        "failure_message": failure_message,
        "created_at": "2026-09-11T09:29:00Z",
        "completed_at": (
            "2026-09-11T09:31:00Z" if status in {"completed", "failed", "canceled"} else None
        ),
    }


def turn(speaker: str, text: str, offset: int | None = 0) -> dict[str, Any]:
    """One transcript turn. ``speaker`` is bot, user or unknown."""
    return {"offset_seconds": offset, "speaker": speaker, "text": text}
