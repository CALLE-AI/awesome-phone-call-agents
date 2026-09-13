from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping

TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled"})
STATUS_MAP = {
    "COMPLETED": "completed",
    "FAILED": "failed",
    "CANCELED": "canceled",
    "QUEUED": "queued",
    "IN_PROGRESS": "in_progress",
    "NO_ANSWER": "failed",
    "VOICEMAIL": "failed",
    "BUSY": "failed",
    "EXPIRED": "failed",
}


@dataclass(frozen=True)
class Turn:
    speaker: Literal["bot", "user"]
    text: str


@dataclass(frozen=True)
class CallSnapshot:
    id: str
    status: str
    task_completed: bool | None
    confidence_score: float | None
    confidence_label: str | None
    failure_code: str | None
    completed_at: str | None
    recipient_phone: str | None
    metadata: dict[str, str]
    turns: tuple[Turn, ...]

    @property
    def terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES


@dataclass(frozen=True)
class CallRun:
    call_id: str
    status: str
    recipient_phone: str | None
    completed_at: str | None
    metadata: dict[str, str]
    turns: tuple[Turn, ...]

    @property
    def readable(self) -> bool:
        return bool(self.call_id)


def parse_turns(raw: Any) -> tuple[Turn, ...]:
    if not isinstance(raw, list):
        return ()
    turns = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        speaker = "user" if entry.get("speaker") == "user" else "bot"
        turns.append(Turn(speaker=speaker, text=str(entry.get("text", ""))))
    return tuple(turns)


def snapshot_from(body: Mapping[str, Any]) -> CallSnapshot:
    recipients = body.get("recipients") or [{}]
    first = recipients[0] if isinstance(recipients[0], dict) else {}
    attempts = first.get("attempts") or [{}]
    last = attempts[-1] if isinstance(attempts[-1], dict) else {}
    confidence = body.get("completion_confidence") or {}
    label = confidence.get("label")
    return CallSnapshot(
        id=str(body.get("id", "")),
        status=str(body.get("status", "")),
        task_completed=body.get("task_completed"),
        confidence_score=confidence.get("score"),
        confidence_label=label.lower() if isinstance(label, str) else None,
        failure_code=body.get("failure_code"),
        completed_at=body.get("completed_at"),
        recipient_phone=last.get("phone") or (first.get("phones") or [None])[0],
        metadata=dict(body.get("metadata") or {}),
        turns=parse_turns(last.get("transcript_turns")),
    )


def run_from(body: Mapping[str, Any]) -> CallRun:
    return CallRun(
        call_id=str(body.get("call_id") or ""),
        status=str(body.get("status") or ""),
        recipient_phone=body.get("recipient_phone"),
        completed_at=body.get("completed_at"),
        metadata=dict(body.get("metadata") or {}),
        turns=parse_turns(body.get("transcript_turns")),
    )
