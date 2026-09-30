"""Turn a terminal CALL-E call task into `Observations`.

Everything unrecognised becomes `unknown` or an empty value. That is
deliberate: CALL-E returns `structured_result: null` when it could not produce
a schema-valid result from the evidence, and an absent field must never quietly
read as "the institution said no".
"""

from __future__ import annotations

from typing import Any

from .models import DirectDebits, Observations, Reached, Ternary, TranscriptTurn


def _ternary(value: Any) -> Ternary:
    try:
        return Ternary(str(value).strip().lower())
    except ValueError:
        return Ternary.UNKNOWN


def _reached(value: Any) -> Reached:
    try:
        return Reached(str(value).strip().lower())
    except ValueError:
        return Reached.UNKNOWN


def _direct_debits(value: Any) -> DirectDebits:
    try:
        return DirectDebits(str(value).strip().lower())
    except ValueError:
        return DirectDebits.UNKNOWN


def _strings(value: Any) -> tuple[str, ...]:
    if isinstance(value, list):
        return tuple(str(item).strip() for item in value if str(item).strip())
    return ()


def transcript_turns(call: dict[str, Any]) -> tuple[TranscriptTurn, ...]:
    """Flatten `recipients[].attempts[].transcript_turns` in call order."""
    collected: list[TranscriptTurn] = []
    for recipient in call.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            for turn in attempt.get("transcript_turns") or []:
                try:
                    offset = float(turn.get("offset_seconds", 0.0))
                except (TypeError, ValueError):
                    offset = 0.0
                collected.append(
                    TranscriptTurn(
                        offset_seconds=offset,
                        speaker=str(turn.get("speaker", "unknown")),
                        text=str(turn.get("text", "")),
                    )
                )
    return tuple(collected)


def observations(call: dict[str, Any]) -> Observations:
    """Read a terminal call task. A null structured result yields all-unknown."""
    result = call.get("structured_result") or {}
    return Observations(
        reached=_reached(result.get("reached")),
        department_named=str(result.get("department_named", "") or "").strip(),
        documents_named=_strings(result.get("documents_named")),
        certified_copy_accepted=_ternary(result.get("certified_copy_accepted")),
        direct_debits_action=_direct_debits(result.get("direct_debits_action")),
        reference_opened=str(result.get("reference_opened", "") or "").strip(),
        executor_only=_ternary(result.get("executor_only")),
        notification_accepted_by_phone=_ternary(
            result.get("notification_accepted_by_phone")
        ),
        evidence_quotes=_strings(result.get("evidence_quotes")),
        turns=transcript_turns(call),
    )
