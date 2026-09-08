"""Unit tests for the four evidence rules (R1-R4)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from evidence.model import Ambiguity, Evidence, EvidenceMatrix, EvidenceType
from evidence.rules import (
    r1_structured_state,
    r2_human_qualification,
    r3_unresolved_evidence,
    r4_decision_deadline,
)

NOW = datetime(2026, 9, 8, 10, 0, tzinfo=timezone.utc)

CALENDAR = Evidence(
    source="calendar",
    type=EvidenceType.STRUCTURED,
    freshness=timedelta(hours=72),
    claim="appointment confirmed 14:00 tomorrow",
    ambiguity=Ambiguity.LOW,
)
EMAIL = Evidence(
    source="email",
    type=EvidenceType.HUMAN,
    freshness=timedelta(hours=72),
    claim="I may need to cancel",
    ambiguity=Ambiguity.HIGH,
)


def test_r1_true_when_structured_evidence_present():
    result = r1_structured_state(EvidenceMatrix((CALENDAR,)))
    assert result.triggered is True
    assert "calendar" in result.reason


def test_r1_false_without_structured_evidence():
    result = r1_structured_state(EvidenceMatrix((EMAIL,)))
    assert result.triggered is False


def test_r2_true_when_human_claim_diverges_from_structured_claim():
    result = r2_human_qualification(EvidenceMatrix((CALENDAR, EMAIL)))
    assert result.triggered is True
    assert "email" in result.reason


def test_r2_false_without_structured_claim_to_compare_against():
    result = r2_human_qualification(EvidenceMatrix((EMAIL,)))
    assert result.triggered is False


def test_r2_false_when_human_claim_agrees_with_structured_claim():
    agreeing = Evidence(
        source="text message",
        type=EvidenceType.HUMAN,
        freshness=timedelta(hours=24),
        claim="Confirmed, I'll be there.",
        ambiguity=Ambiguity.LOW,
    )
    result = r2_human_qualification(EvidenceMatrix((CALENDAR, agreeing)))
    assert result.triggered is False


def test_r2_true_for_a_confident_but_diverging_human_claim():
    """A confidently-stated cancellation (low ambiguity) must still
    trigger R2: polarity comes from claim content, not the ambiguity
    field. This is exactly the gap the first draft of this rule had -
    reading ambiguity alone would have missed a claim this confident.
    """
    confident_cancel = Evidence(
        source="phone note",
        type=EvidenceType.HUMAN,
        freshness=timedelta(hours=24),
        claim="I already cancelled with the front desk this morning.",
        ambiguity=Ambiguity.LOW,
    )
    result = r2_human_qualification(EvidenceMatrix((CALENDAR, confident_cancel)))
    assert result.triggered is True


def test_r2_false_for_a_claim_with_no_recognized_polarity_marker():
    """An unclassifiable claim (no marker either way) must not trigger
    R2 by virtue of high ambiguity alone - the old design's exact bug.
    """
    unclassifiable = Evidence(
        source="voicemail transcript",
        type=EvidenceType.HUMAN,
        freshness=timedelta(hours=24),
        claim="Something came up, I'll try to sort it out.",
        ambiguity=Ambiguity.HIGH,
    )
    result = r2_human_qualification(EvidenceMatrix((CALENDAR, unclassifiable)))
    assert result.triggered is False


def test_r3_true_when_nothing_fresher_has_resolved_the_divergence():
    result = r3_unresolved_evidence(EvidenceMatrix((CALENDAR, EMAIL)))
    assert result.triggered is True


def test_r3_false_without_qualifying_evidence():
    result = r3_unresolved_evidence(EvidenceMatrix((CALENDAR,)))
    assert result.triggered is False


def test_r3_false_when_fresher_low_ambiguity_evidence_resolves_it():
    fresher_confirmation = Evidence(
        source="text message",
        type=EvidenceType.HUMAN,
        freshness=timedelta(hours=1),
        claim="Confirmed, I'll be there.",
        ambiguity=Ambiguity.LOW,
    )
    matrix = EvidenceMatrix((CALENDAR, EMAIL, fresher_confirmation))
    result = r3_unresolved_evidence(matrix)
    assert result.triggered is False


def test_r4_true_when_deadline_is_within_threshold():
    deadline = NOW + timedelta(hours=10)
    result = r4_decision_deadline(deadline, NOW, threshold=timedelta(hours=48))
    assert result.triggered is True


def test_r4_false_when_deadline_is_beyond_threshold():
    deadline = NOW + timedelta(hours=100)
    result = r4_decision_deadline(deadline, NOW, threshold=timedelta(hours=48))
    assert result.triggered is False


def test_r4_threshold_is_a_parameter_not_a_module_constant():
    """The same deadline is or isn't decision-critical purely based on
    the threshold passed in - proving the threshold is case data, not a
    hardcoded engine default.
    """
    deadline = NOW + timedelta(hours=30)
    assert r4_decision_deadline(deadline, NOW, threshold=timedelta(hours=48)).triggered is True
    assert r4_decision_deadline(deadline, NOW, threshold=timedelta(hours=12)).triggered is False


def test_ghost_appointment_style_matrix_triggers_all_four_rules():
    """The exact evidence shape from cases/ghost-appointment.json:
    calendar (structured, confirmed) + email (human, diverging) + a
    follow-up absence entry, all three days old, deadline tomorrow.
    """
    follow_up = Evidence(
        source="follow-up",
        type=EvidenceType.ABSENCE,
        freshness=timedelta(hours=72),
        claim="no confirmation received",
        ambiguity=Ambiguity.HIGH,
    )
    matrix = EvidenceMatrix((CALENDAR, EMAIL, follow_up))
    deadline = NOW + timedelta(hours=4)

    assert r1_structured_state(matrix).triggered is True
    assert r2_human_qualification(matrix).triggered is True
    assert r3_unresolved_evidence(matrix).triggered is True
    assert r4_decision_deadline(deadline, NOW, threshold=timedelta(hours=24)).triggered is True
