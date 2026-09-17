"""Fail-closed triage.

This module decides what happens to a student on immunisation day. It is the
safety boundary of the whole app, so it is deliberately dull: pure functions,
no I/O, no model calls, no network.

The rule is that clearance is *earned*, never assumed. A record is cleared only
when every required signal is unambiguously positive. Anything else - a missing
field, an unsure guardian, a low-confidence transcript, an unrecognised enum
value - routes to a human. Silence is never consent.

The app never decides whether a child is medically fit for a vaccine. It records
what a guardian reported and routes anything with clinical content to the nurse
who is qualified to read it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Below this, CALL-E's own confidence in its task judgement is too low to act on
# unreviewed. Chosen conservatively: this gates a medical session for a child.
MIN_CONFIDENCE = 0.70

CLEARED = "cleared_for_school_session"
NURSE_REVIEW = "needs_nurse_review"
PRIVATE_PROVIDER = "routed_to_private_provider"
DECLINED = "declined"
UNREACHABLE = "unreachable"


@dataclass
class Triage:
    disposition: str
    reasons: list[str] = field(default_factory=list)

    @property
    def needs_human(self) -> bool:
        return self.disposition == NURSE_REVIEW

    def to_dict(self) -> dict[str, Any]:
        return {"disposition": self.disposition, "reasons": list(self.reasons)}


def _is(value: Any, *allowed: str) -> bool:
    return isinstance(value, str) and value in allowed


def triage_record(
    result: dict[str, Any] | None,
    *,
    task_completed: bool | None = None,
    confidence: float | None = None,
    min_confidence: float = MIN_CONFIDENCE,
) -> Triage:
    """Classify one guardian call outcome.

    ``result`` is the per-recipient structured result from CALL-E, or None when
    the call produced nothing usable.
    """
    reasons: list[str] = []

    if not isinstance(result, dict) or not result:
        return Triage(UNREACHABLE, ["no structured result returned"])

    reached = result.get("reached_guardian")
    if not _is(reached, "yes"):
        # Nobody was reached. That is not a reviewable clinical outcome, it is
        # simply an outstanding call for the office to retry.
        return Triage(UNREACHABLE, ["guardian not reached"])

    # --- signals that always force a human read -------------------------------
    if task_completed is not True:
        reasons.append("CALL-E did not report the task as completed")

    if confidence is None:
        reasons.append("no completion confidence returned")
    elif confidence < min_confidence:
        reasons.append(
            f"completion confidence {confidence:.2f} below {min_confidence:.2f}"
        )

    if not _is(result.get("identity_confirmed"), "yes"):
        reasons.append("guardian identity not confirmed")

    if _is(result.get("allergy_reported"), "severe"):
        reasons.append("severe allergy reported")
    elif not _is(result.get("allergy_reported"), "none", "mild"):
        reasons.append("allergy history unclear")

    if not _is(result.get("unwell_today"), "no"):
        reasons.append("student may be unwell today")

    if not _is(result.get("prior_dose_reported"), "yes", "no"):
        reasons.append("prior dose history unclear")

    if _is(result.get("callback_requested"), "yes"):
        reasons.append("guardian asked for a call back from a person")

    if (result.get("guardian_questions") or "").strip():
        reasons.append("guardian asked an unanswered question")

    # --- routing --------------------------------------------------------------
    consent = result.get("consent")
    route = result.get("route")

    # Route is checked before consent. `consent` means consent *for the school
    # session*, so a guardian using their own doctor correctly declines the
    # session while still vaccinating the child. Reading consent first would
    # file them as a refusal and lose that distinction.
    if _is(route, "private_provider"):
        # The child is still getting vaccinated, just not by us. All the school
        # needs is to not vaccinate them on the day.
        return Triage(PRIVATE_PROVIDER, ["guardian will use their own provider"])

    if _is(consent, "declined") or _is(route, "decline"):
        # An explicit refusal is a complete, actionable answer. It needs no
        # clinical review - it needs to be recorded and respected.
        return Triage(DECLINED, ["guardian declined the school session"])

    if not _is(consent, "granted"):
        reasons.append("consent not clearly granted")

    if not _is(route, "school_session"):
        reasons.append("route not clearly chosen")

    if reasons:
        return Triage(NURSE_REVIEW, reasons)

    if _is(result.get("prior_dose_reported"), "yes"):
        # Consent is clear, but a reported prior dose is a clinical question:
        # duplicate doses are exactly what the nurse must rule out.
        return Triage(NURSE_REVIEW, ["prior dose reported; nurse to verify record"])

    return Triage(CLEARED, [])


def summarise(triages: list[Triage]) -> dict[str, int]:
    counts = {
        CLEARED: 0,
        NURSE_REVIEW: 0,
        PRIVATE_PROVIDER: 0,
        DECLINED: 0,
        UNREACHABLE: 0,
    }
    for t in triages:
        counts[t.disposition] = counts.get(t.disposition, 0) + 1
    return counts
