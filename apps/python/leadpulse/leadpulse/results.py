"""Reading a terminal CALL-E call task, and turning it into one lead decision."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from leadpulse.scoring import HOT_LEAD_THRESHOLD, QUALIFIED_THRESHOLD, explain, score_lead

TERMINAL = {"completed", "failed", "canceled"}


def _recipient(call: dict[str, Any]) -> dict[str, Any]:
    recipients = call.get("recipients") or []
    return recipients[0] if recipients else {}


def extract_result(call: dict[str, Any]) -> dict[str, Any] | None:
    """The task-level result is authoritative; fall back to the recipient result."""
    return call.get("structured_result") or _recipient(call).get("structured_result") or None


def extract_transcript(call: dict[str, Any]) -> str | None:
    lines: list[str] = []
    for attempt in _recipient(call).get("attempts") or []:
        for turn in attempt.get("transcript_turns") or []:
            who = {"bot": "Agent", "user": "Lead"}.get(turn.get("speaker", ""), "Unknown")
            text = (turn.get("text") or "").strip()
            if text:
                lines.append(f"{who}: {text}")
    return "\n".join(lines) or None


def extract_duration_seconds(call: dict[str, Any]) -> int | None:
    best: int | None = None
    for attempt in _recipient(call).get("attempts") or []:
        start, end = attempt.get("started_at"), attempt.get("completed_at")
        if not (start and end):
            continue
        try:
            secs = int(
                (
                    datetime.fromisoformat(end.replace("Z", "+00:00"))
                    - datetime.fromisoformat(start.replace("Z", "+00:00"))
                ).total_seconds()
            )
        except ValueError:
            continue
        if secs >= 0 and (best is None or secs > best):
            best = secs
    return best


def extract_failure(call: dict[str, Any]) -> str | None:
    """Raw failure code and message, preserved for support. Never branched on."""
    attempts = _recipient(call).get("attempts") or []
    last = attempts[-1] if attempts else {}
    code = last.get("failure_code") or call.get("failure_code")
    msg = last.get("failure_message") or call.get("failure_message")
    if not (code or msg):
        return None
    return f"{code or 'failed'}: {msg}" if msg else str(code)


def decide(call: dict[str, Any]) -> dict[str, Any]:
    """Map one call snapshot to a lead decision. Pure: performs no side effects.

    ``failure_code`` has no published enum, so a failed call is reported as failed
    with CALL-E's raw reason - it is never guessed into "no answer". Only the
    schema-validated ``reached_lead`` field can say the lead was not reached.
    """
    status = call.get("status")
    decision: dict[str, Any] = {
        "call_id": call.get("id"),
        "lead_id": (call.get("metadata") or {}).get("lead_id"),
        "call_status": status,
        "score": None,
        "score_breakdown": None,
        "hot_lead": False,
        "send_booking_link": False,
        "reason": None,
        "summary": call.get("summary"),
    }
    if status not in TERMINAL:
        decision.update(outcome="in_progress")
        return decision
    if status != "completed":
        decision.update(outcome="failed", reason=extract_failure(call) or status)
        return decision

    result = extract_result(call)
    if not result:
        decision.update(outcome="result_validation_failed", reason="CALL-E returned no schema-valid result")
        return decision
    if result.get("reached_lead") != "yes":
        decision.update(outcome="no_answer", reason=f"reached_lead={result.get('reached_lead')}")
        return decision

    score = score_lead(result) or 0
    interested = result.get("interest_level") in ("strong", "moderate")
    decision.update(
        outcome="qualified" if score >= QUALIFIED_THRESHOLD else "not_qualified",
        score=score,
        score_breakdown=explain(result),
        hot_lead=score >= HOT_LEAD_THRESHOLD,
        send_booking_link=interested and result.get("wants_booking_link") == "yes",
        notes=result.get("lead_notes"),
    )
    return decision
