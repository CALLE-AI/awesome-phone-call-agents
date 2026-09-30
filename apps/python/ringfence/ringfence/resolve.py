"""Outcome resolution for the verification call's raw CALL-E result.

Adapted from apps/python/calltruth's resolve.py (same repo, same author) —
kept as a self-contained copy, not a cross-directory import, per this repo's
contribution rule that each ``apps/*`` entry stays self-contained. The logic
is unchanged: CALL-E's own docs (docs.heycall-e.com, "Accepted call
execution outcomes") state that the Calls API "does not guarantee a
distinct no-answer or callee-decline value" and that ``failure_code`` has
"no published enum" to branch on. ``decide.py`` must not trust a raw
``failure_code`` any more here than calltruth does elsewhere — a fraud
disposition is exactly the kind of decision where silently guessing wrong
is worse than saying "ambiguous."
"""

from __future__ import annotations

from dataclasses import dataclass, field

ANSWERED_SUCCESS = "answered_success"
ANSWERED_DECLINED = "answered_declined"
POLICY_OR_CONTENT_REFUSAL = "policy_or_content_refusal"
MALFORMED_OR_UNSUPPORTED_DESTINATION = "malformed_or_unsupported_destination"
REJECTED_BEFORE_RING = "rejected_before_ring"
CONNECTION_FAILED_DURING_ATTEMPT = "connection_failed_during_attempt"
NO_ANSWER_CONFIRMED = "no_answer_confirmed"
UNRESOLVED_AMBIGUOUS = "unresolved_ambiguous"

ALL_OUTCOMES = (
    ANSWERED_SUCCESS,
    ANSWERED_DECLINED,
    POLICY_OR_CONTENT_REFUSAL,
    MALFORMED_OR_UNSUPPORTED_DESTINATION,
    REJECTED_BEFORE_RING,
    CONNECTION_FAILED_DURING_ATTEMPT,
    NO_ANSWER_CONFIRMED,
    UNRESOLVED_AMBIGUOUS,
)

_POLICY_REFUSAL_MARKERS = (
    "confirmation-code",
    "confirmation code",
    "otp",
    "credential",
    "access credential",
    "emergency",
    "urgent safety",
    "policy_violation",
    "policy violation",
    "i can't place a call that involves",
)

_MALFORMED_DESTINATION_MARKERS = (
    "region",
    "not supported",
    "unsupported_region",
    "unsupported region",
    "unsupported_language",
    "invalid",
    "e.164",
    "e164",
    "malformed",
    "phone number",
)


@dataclass(frozen=True)
class Resolution:
    outcome: str
    confidence: str  # "high" | "medium" | "low"
    evidence: list[str] = field(default_factory=list)
    raw_status: str | None = None
    raw_failure_code: str | None = None

    def as_dict(self) -> dict:
        return {
            "outcome": self.outcome,
            "confidence": self.confidence,
            "evidence": list(self.evidence),
            "raw_status": self.raw_status,
            "raw_failure_code": self.raw_failure_code,
        }


def _text_matches(text: str | None, markers: tuple[str, ...]) -> str | None:
    if not text:
        return None
    lowered = text.lower()
    for marker in markers:
        if marker in lowered:
            return marker
    return None


def _combined_text(*parts: str | None) -> str:
    return " ".join(p for p in parts if p)


def classify(call: dict, attempts: list[dict], events: list[dict]) -> Resolution:
    """Classify one verification call's real outcome from call + attempts + events."""
    status = call.get("status")
    failure_code = call.get("failure_code")
    failure_message = call.get("failure_message")
    task_completed = call.get("task_completed")

    attempt = attempts[0] if attempts else None
    attempt_started = attempt.get("started_at") if attempt else None
    attempt_completed_at = attempt.get("completed_at") if attempt else None
    transcript_turns = (attempt.get("transcript_turns") if attempt else None) or []
    attempt_failure_message = attempt.get("failure_message") if attempt else None
    attempt_failure_code = attempt.get("failure_code") if attempt else None

    event_text = _combined_text(*(e.get("message") for e in events))
    full_text = _combined_text(failure_message, attempt_failure_message, event_text)

    never_dialed = attempt is None or attempt_started is None

    if status in ("failed", "canceled") and never_dialed:
        policy_marker = _text_matches(full_text, _POLICY_REFUSAL_MARKERS)
        if policy_marker:
            return Resolution(
                outcome=POLICY_OR_CONTENT_REFUSAL,
                confidence="high",
                evidence=["never dialed (no attempt start)", f"message matched policy marker: {policy_marker!r}"],
                raw_status=status,
                raw_failure_code=failure_code,
            )
        malformed_marker = _text_matches(full_text, _MALFORMED_DESTINATION_MARKERS)
        if malformed_marker:
            return Resolution(
                outcome=MALFORMED_OR_UNSUPPORTED_DESTINATION,
                confidence="high",
                evidence=["never dialed (no attempt start)", f"message matched destination marker: {malformed_marker!r}"],
                raw_status=status,
                raw_failure_code=failure_code,
            )
        return Resolution(
            outcome=REJECTED_BEFORE_RING,
            confidence="medium",
            evidence=["never dialed (no attempt start)", "no known marker matched failure/attempt/event text"],
            raw_status=status,
            raw_failure_code=failure_code,
        )

    if not never_dialed and attempt_completed_at and not transcript_turns:
        # An attempt with a start and end timestamp but no transcript could
        # mean two very different real-world things: the phone genuinely
        # rang with nobody picking up (a confirmed no-answer), or the
        # provider failed to actually connect the call at all (started_at
        # and completed_at identical -- zero ring time -- and/or the
        # attempt itself carries a failure_code). Pre-submission
        # validation against the live API returned exactly this shape
        # (attempt-level failure_code, started_at == completed_at), which
        # this function previously mislabeled no_answer_confirmed. Treat
        # the two as distinct outcomes: an institution
        # should retry a genuine no-answer differently than a connection
        # failure.
        zero_duration = attempt_started == attempt_completed_at
        if zero_duration or attempt_failure_code:
            evidence = ["attempt started and completed", "transcript is empty (no conversation occurred)"]
            if zero_duration:
                evidence.append("attempt started_at == completed_at (zero ring time)")
            if attempt_failure_code:
                evidence.append(f"attempt carries its own failure_code: {attempt_failure_code!r}")
            return Resolution(
                outcome=CONNECTION_FAILED_DURING_ATTEMPT,
                confidence="high" if attempt_failure_code else "medium",
                evidence=evidence,
                raw_status=status,
                raw_failure_code=failure_code,
            )
        return Resolution(
            outcome=NO_ANSWER_CONFIRMED,
            confidence="high",
            evidence=["attempt started and completed", "transcript is empty (no conversation occurred)"],
            raw_status=status,
            raw_failure_code=failure_code,
        )

    if not never_dialed and transcript_turns and task_completed is False:
        return Resolution(
            outcome=ANSWERED_DECLINED,
            confidence="medium",
            evidence=["transcript has turns (conversation occurred)", "task_completed is false"],
            raw_status=status,
            raw_failure_code=failure_code,
        )

    if not never_dialed and transcript_turns and task_completed is True:
        return Resolution(
            outcome=ANSWERED_SUCCESS,
            confidence="high",
            evidence=["transcript has turns (conversation occurred)", "task_completed is true"],
            raw_status=status,
            raw_failure_code=failure_code,
        )

    return Resolution(
        outcome=UNRESOLVED_AMBIGUOUS,
        confidence="low",
        evidence=[
            "no rule above matched with sufficient signal",
            f"raw status={status!r} failure_code={failure_code!r} task_completed={task_completed!r}",
        ],
        raw_status=status,
        raw_failure_code=failure_code,
    )


def naive_classify(call: dict) -> str:
    """What most integrations do today: trust status/failure_code directly.

    Used only to measure disagreement in tests/test_evaluation.py — never
    used in the real disposition path (decide.py always calls classify()).
    """
    status = call.get("status")
    failure_code = call.get("failure_code")
    task_completed = call.get("task_completed")
    if status == "completed" and task_completed:
        return ANSWERED_SUCCESS
    if status == "completed":
        return ANSWERED_DECLINED
    if failure_code and "no_answer" in str(failure_code).lower():
        return NO_ANSWER_CONFIRMED
    if status in ("failed", "canceled"):
        return REJECTED_BEFORE_RING
    return UNRESOLVED_AMBIGUOUS
