"""FieldLine's safety protocol: pure decision logic over CALL-E results.

Deliberately deterministic (no LLM here): given a terminal `call_task`
dict from CALL-E, classify what happened and decide the next step. All
conversational intelligence lives on the CALL-E side; all safety policy
lives here, where it is unit-testable.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal

Call = dict[str, Any]


class CheckinOutcome(StrEnum):
    SAFE = "safe"
    NEEDS_HELP = "needs_help"
    DURESS = "duress"
    NO_ANSWER = "no_answer"
    UNCLEAR = "unclear"


class EscalationOutcome(StrEnum):
    STAND_DOWN = "stand_down"  # contact heard from worker after the missed check-in
    HANDED_OFF = "handed_off"  # contact explicitly assumed coordination
    WILL_CHECK = "will_check"  # reached + informed, but nobody owns it yet
    NOT_REACHED = "not_reached"


@dataclass(frozen=True)
class NextStep:
    kind: Literal["schedule_next", "retry", "escalate"]
    silent: bool = False  # duress: escalate without recontacting the worker
    reason: str = ""


def _has_transcript(call: Call) -> bool:
    for recipient in call.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            if attempt.get("transcript_turns"):
                return True
    return False


def classify_checkin(call: Call) -> CheckinOutcome:
    """Map a terminal CALL-E call_task dict onto a check-in outcome."""
    if call.get("status") in ("failed", "canceled"):
        # Includes FieldLine's fail-soft synthetic result when the API is
        # unreachable: an unplaceable call is treated as an unanswered one
        # so the safety cascade keeps moving instead of crashing.
        return CheckinOutcome.NO_ANSWER

    result = call.get("structured_result")
    if not isinstance(result, dict):
        # Completed but nothing extracted: if we spoke to someone, it is
        # ambiguous (UNCLEAR -> retry); if nobody answered, NO_ANSWER.
        return CheckinOutcome.UNCLEAR if _has_transcript(call) else CheckinOutcome.NO_ANSWER

    if result.get("duress_phrase_detected"):
        return CheckinOutcome.DURESS  # overrides any stated "safe"

    status = result.get("checkin_status")
    if status == "safe":
        return CheckinOutcome.SAFE
    if status in ("needs_assistance", "emergency"):
        return CheckinOutcome.NEEDS_HELP
    return CheckinOutcome.UNCLEAR


def decide(outcome: CheckinOutcome, *, dials_made: int, max_retries: int) -> NextStep:
    """Safety policy for what happens after a check-in call."""
    if outcome is CheckinOutcome.DURESS:
        return NextStep("escalate", silent=True, reason="duress phrase detected on call")
    if outcome is CheckinOutcome.NEEDS_HELP:
        return NextStep("escalate", reason="worker requested assistance")
    if outcome is CheckinOutcome.SAFE:
        return NextStep("schedule_next", reason="worker confirmed safe")
    # NO_ANSWER / UNCLEAR
    if dials_made <= max_retries:
        return NextStep("retry", reason=f"{outcome.value} (dial {dials_made} of {max_retries + 1})")
    return NextStep("escalate", reason=f"{outcome.value} after {dials_made} dials")


def classify_escalation(call: Call) -> EscalationOutcome:
    """Map a terminal escalation-call dict onto a ladder outcome."""
    if call.get("status") in ("failed", "canceled"):
        return EscalationOutcome.NOT_REACHED
    result = call.get("structured_result")
    if not isinstance(result, dict) or not result.get("contact_reached"):
        return EscalationOutcome.NOT_REACHED
    if result.get("heard_from_worker_since_checkin"):
        return EscalationOutcome.STAND_DOWN
    if result.get("assuming_coordination"):
        return EscalationOutcome.HANDED_OFF
    return EscalationOutcome.WILL_CHECK
