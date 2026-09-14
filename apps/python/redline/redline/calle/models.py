"""Translate CALL-E payloads into REDLINE's normalised :class:`CallRecord`.

This module and :mod:`redline.calle.client` are the only two places that know
what a CALL-E response looks like. Everything downstream sees a
:class:`~redline.types.CallRecord`. Provenance remains on the record so a static
finding, a replayed payload, and an observed call cannot be presented as the
same evidence.

The mapping is deliberately defensive. A published contract and a running
service are not the same document: fields go missing, enums grow members, and a
test bench that crashes on an unexpected payload is worse than useless. So
unknown speaker labels degrade to ``unknown``, absent optional fields become
``None``, and only genuinely unusable payloads raise.

Reference: CALL-E Developer API, OpenAPI 3.1, version 0.6.0.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Literal

from redline.types import (
    CallRecord,
    ConfidenceScore,
    GroundTruth,
    Speaker,
    Turn,
)

__all__ = [
    "CalleParseError",
    "ResultLevel",
    "call_record_from_payload",
    "speaker_from_calle",
    "unwrap_payload",
]

ResultLevel = Literal["auto", "task", "recipient"]


class CalleParseError(ValueError):
    """A CALL-E payload could not be read as a call outcome."""


# CALL-E labels transcript turns `bot` / `user` / `unknown`. Anything outside
# that set is mapped to `unknown` rather than guessed: see the module docstring.
_SPEAKER_MAP: Mapping[str, Speaker] = {
    "bot": Speaker.AGENT,
    "agent": Speaker.AGENT,
    "user": Speaker.CALLEE,
    "callee": Speaker.CALLEE,
    "unknown": Speaker.UNKNOWN,
}


def speaker_from_calle(label: object) -> Speaker:
    """Map a CALL-E speaker label onto ours, degrading rather than failing."""
    if not isinstance(label, str):
        return Speaker.UNKNOWN
    return _SPEAKER_MAP.get(label.strip().casefold(), Speaker.UNKNOWN)


def unwrap_payload(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    """Return the ``call_task`` object, whichever surface delivered it.

    ``POST /v1/calls`` and ``GET /v1/calls/{id}`` return the object directly;
    a webhook wraps the same object in ``{"id": "evt_...", "data": {...}}``.
    Accepting both means a fixture recorded from a webhook and one recorded
    from a poll are interchangeable.
    """
    if payload.get("object") == "call_task":
        return payload
    data = payload.get("data")
    if isinstance(data, Mapping):
        return data
    return payload


def call_record_from_payload(
    payload: Mapping[str, Any],
    *,
    scenario_id: str,
    ground_truth: GroundTruth,
    transport: str,
    recipient_index: int = 0,
    result_level: ResultLevel = "auto",
) -> CallRecord:
    """Build a :class:`CallRecord` from one CALL-E call task.

    REDLINE models one scenario as one call to one recipient, so
    ``recipient_index`` selects which recipient of a batch task to read. When a
    recipient has several dial attempts -- CALL-E retried -- the **last** one
    carries the conversation that produced the result, so that is the transcript
    we evaluate. Earlier attempts stay available in :attr:`CallRecord.raw`.

    ``result_level`` decides which structured result is the subject of the
    evaluation. ``auto`` prefers the recipient-level result when present,
    because a per-recipient schema is the more specific claim about the person
    who actually answered; it falls back to the task-level result otherwise.
    """
    task = unwrap_payload(payload)
    if not isinstance(task, Mapping):
        raise CalleParseError("payload is not a JSON object")

    recipient = _select_recipient(task, recipient_index)
    attempt = _select_attempt(recipient)

    return CallRecord(
        scenario_id=scenario_id,
        transport=transport,
        ground_truth=ground_truth,
        transcript=_transcript_from_attempt(attempt),
        task_completed=_optional_bool(task.get("task_completed")),
        completion_confidence=_confidence(task.get("completion_confidence")),
        structured_result=_structured_result(task, recipient, result_level),
        evidence=_evidence(task.get("evidence")),
        summary=_optional_str(task.get("summary")),
        failure_code=_failure_code(task, attempt),
        duration_seconds=_duration_seconds(attempt),
        raw=dict(task),
    )


# --- Selection ---------------------------------------------------------------


def _select_recipient(task: Mapping[str, Any], index: int) -> Mapping[str, Any] | None:
    recipients = task.get("recipients")
    if not isinstance(recipients, Sequence) or not recipients:
        # A task-only call (no explicit `recipients`) is legal: CALL-E infers
        # the target from the task text. There is simply no recipient record.
        return None
    if index >= len(recipients):
        raise CalleParseError(
            f"recipient index {index} out of range: "
            f"the call task has {len(recipients)} recipient(s)"
        )
    recipient = recipients[index]
    if not isinstance(recipient, Mapping):
        raise CalleParseError(f"recipient {index} is not a JSON object")
    return recipient


def _select_attempt(
    recipient: Mapping[str, Any] | None,
) -> Mapping[str, Any] | None:
    if recipient is None:
        return None
    attempts = recipient.get("attempts")
    if not isinstance(attempts, Sequence) or not attempts:
        return None
    last = attempts[-1]
    return last if isinstance(last, Mapping) else None


# --- Field extraction --------------------------------------------------------


def _transcript_from_attempt(
    attempt: Mapping[str, Any] | None,
) -> tuple[Turn, ...]:
    if attempt is None:
        return ()
    turns = attempt.get("transcript_turns")
    if not isinstance(turns, Sequence):
        return ()

    built: list[Turn] = []
    for index, raw_turn in enumerate(turns):
        if not isinstance(raw_turn, Mapping):
            continue
        text = raw_turn.get("text")
        if not isinstance(text, str):
            continue
        built.append(
            Turn(
                index=index,
                speaker=speaker_from_calle(raw_turn.get("speaker")),
                text=text,
                offset_seconds=_non_negative_int(raw_turn.get("offset_seconds")),
            )
        )
    return tuple(built)


def _structured_result(
    task: Mapping[str, Any],
    recipient: Mapping[str, Any] | None,
    level: ResultLevel,
) -> Mapping[str, Any] | None:
    task_result = _optional_mapping(task.get("structured_result"))
    recipient_result = (
        _optional_mapping(recipient.get("structured_result"))
        if recipient is not None
        else None
    )

    if level == "task":
        return task_result
    if level == "recipient":
        return recipient_result
    return recipient_result if recipient_result is not None else task_result


def _confidence(value: object) -> ConfidenceScore | None:
    if not isinstance(value, Mapping):
        return None
    score = value.get("score")
    label = value.get("label")
    if not isinstance(score, (int, float)) or isinstance(score, bool):
        return None
    try:
        return ConfidenceScore(
            score=float(score),
            label=label if isinstance(label, str) else "unknown",
        )
    except ValueError:
        # An out-of-range score is a platform bug, not a reason to abandon the
        # rest of the record. Drop the field and keep going.
        return None


def _evidence(value: object) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(item for item in value if isinstance(item, str))


def _failure_code(
    task: Mapping[str, Any], attempt: Mapping[str, Any] | None
) -> str | None:
    # The attempt-level code is the more specific of the two when both exist.
    if attempt is not None:
        code = _optional_str(attempt.get("failure_code"))
        if code is not None:
            return code
    return _optional_str(task.get("failure_code"))


def _duration_seconds(attempt: Mapping[str, Any] | None) -> int | None:
    if attempt is None:
        return None
    started = _timestamp(attempt.get("started_at"))
    completed = _timestamp(attempt.get("completed_at"))
    if started is None or completed is None:
        return None
    delta = (completed - started).total_seconds()
    return int(delta) if delta >= 0 else None


# --- Coercion helpers --------------------------------------------------------


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) and value != "" else None


def _optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _optional_mapping(value: object) -> Mapping[str, Any] | None:
    return dict(value) if isinstance(value, Mapping) else None


def _non_negative_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if value >= 0 else None


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
