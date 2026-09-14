"""The transport boundary.

One interface, three implementations: `fixture` (scripted, no network), `replay` (real
redacted payloads, no network), and `calle` (the live REST API). Everything above this
line works on `CallSnapshot`, which is a parse of the CALL-E `CallTask` object and nothing
more. No transport is allowed to reach a business conclusion.

There is no cancel operation on this interface because CALL-E publishes no cancel
endpoint. Once `submit()` returns a call id, the call is out of our hands.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

# CallStatus values from the CALL-E contract.
TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled"})
NON_TERMINAL_STATUSES = frozenset({"queued", "in_progress"})


@dataclass(frozen=True)
class TranscriptTurn:
    """One turn, as published in `attempts[].transcript_turns[]`.

    `offset_seconds` is nullable in the contract ("null when the source line did not
    include a parseable timestamp"), so it is display metadata and never an ordering key.
    Order comes from array position.
    """

    index: int
    speaker: str
    text: str
    offset_seconds: int | None = None


@dataclass(frozen=True)
class CallSnapshot:
    """A parsed CALL-E call task. Provider facts only."""

    call_id: str
    status: str
    task_completed: bool | None
    confidence_score: float | None
    confidence_label: str | None
    recipient_result: dict | None
    recipient_status: str | None
    transcript_turns: tuple[TranscriptTurn, ...]
    metadata: dict
    evidence: tuple[str, ...] = ()
    failure_code: str | None = None
    failure_message: str | None = None
    raw: dict = field(default_factory=dict, compare=False, repr=False)

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES

    @property
    def completed_cleanly(self) -> bool:
        return self.status == "completed"


@dataclass(frozen=True)
class SubmitResult:
    """The three outcomes a submission can have. `unknown` is not an error to retry."""

    kind: Literal["accepted", "rejected", "unknown"]
    call_id: str | None = None
    reason: str | None = None
    error_code: str | None = None

    @staticmethod
    def accepted(call_id: str) -> SubmitResult:
        return SubmitResult(kind="accepted", call_id=call_id)

    @staticmethod
    def rejected(reason: str, error_code: str | None = None) -> SubmitResult:
        return SubmitResult(kind="rejected", reason=reason, error_code=error_code)

    @staticmethod
    def unknown(reason: str, error_code: str | None = None) -> SubmitResult:
        return SubmitResult(kind="unknown", reason=reason, error_code=error_code)


class TransportError(RuntimeError):
    """Raised for a transport-level defect that must stop the run, not advance a ladder."""


class CallTransport(Protocol):
    """What the dispatcher and the intake worker are allowed to ask of a provider."""

    def submit(
        self,
        *,
        task_text: str,
        phone_e164: str,
        locale: str,
        region: str,
        recipient_result_schema: dict,
        idempotency_key: str,
        metadata: dict,
    ) -> SubmitResult:
        """Place at most one call. The same key must never place a second one."""

    def read(self, call_id: str) -> CallSnapshot:
        """Authoritative re-read of one call. This is what business logic runs on."""


def parse_call_task(payload: dict) -> CallSnapshot:
    """Parse a CALL-E `CallTask` object into a snapshot.

    This app sends exactly one recipient with a `recipient_result_schema`, so the outcome
    is read from `recipients[0].structured_result`, never from the task-level
    `structured_result`.

    Transcript turns come from the last attempt that produced any, which is the attempt
    that actually connected. Earlier attempts stay in the redacted raw snapshot.
    """
    if not isinstance(payload, dict):
        raise TransportError(f"expected a call task object, got {type(payload).__name__}")
    call_id = payload.get("id")
    status = payload.get("status")
    if not isinstance(call_id, str) or not isinstance(status, str):
        raise TransportError("call task is missing a string id or status")

    confidence = payload.get("completion_confidence") or {}
    if not isinstance(confidence, dict):
        confidence = {}

    recipients = payload.get("recipients") or []
    recipient: dict[str, Any] = recipients[0] if recipients else {}
    if not isinstance(recipient, dict):
        recipient = {}

    turns: tuple[TranscriptTurn, ...] = ()
    for attempt in recipient.get("attempts") or []:
        if not isinstance(attempt, dict):
            continue
        raw_turns = attempt.get("transcript_turns") or []
        parsed = tuple(
            TranscriptTurn(
                index=index,
                speaker=str(turn.get("speaker", "unknown")),
                text=str(turn.get("text", "")),
                offset_seconds=turn.get("offset_seconds"),
            )
            for index, turn in enumerate(raw_turns)
            if isinstance(turn, dict)
        )
        if parsed:
            turns = parsed

    evidence_raw = payload.get("evidence") or []
    evidence = tuple(str(item) for item in evidence_raw if isinstance(item, str))

    metadata = payload.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}

    return CallSnapshot(
        call_id=call_id,
        status=status,
        task_completed=payload.get("task_completed"),
        confidence_score=confidence.get("score"),
        confidence_label=confidence.get("label"),
        recipient_result=recipient.get("structured_result"),
        recipient_status=recipient.get("status"),
        transcript_turns=turns,
        metadata=metadata,
        evidence=evidence,
        failure_code=payload.get("failure_code"),
        failure_message=payload.get("failure_message"),
        raw=payload,
    )
