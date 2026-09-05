"""Unit tests for verdict.reconcile() - the structured_result -> Verdict
reconciliation table, with an exhaustive check of the absolute rule:
unresolved evidence is never treated as cancelled.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from evidence.model import Ambiguity, Evidence, EvidenceMatrix, EvidenceType
from verdict import ACTION_HUMAN_REVIEW, patient_intent_result_schema, reconcile

DECISION_OPTIONS = {
    "if_confirmed": "KEEP_SLOT",
    "if_cancelled": "RELEASE_SLOT",
}

MATRIX = EvidenceMatrix(
    (
        Evidence("calendar", EvidenceType.STRUCTURED, timedelta(hours=72), "appointment confirmed", Ambiguity.LOW),
    )
)

PATIENT_INTENTS = ("confirmed", "cancelled", "uncertain", "unknown", None)
ANSWERED_BY_VALUES = ("human", "voicemail", "ivr", "unknown", None)


def test_confirmed_by_human_resolves_to_keep_slot():
    result = reconcile({"patient_intent": "confirmed", "answered_by": "human"}, DECISION_OPTIONS, MATRIX)
    assert result.status == "RESOLVED"
    assert result.action == "KEEP_SLOT"


def test_cancelled_by_human_resolves_to_release_slot():
    result = reconcile({"patient_intent": "cancelled", "answered_by": "human"}, DECISION_OPTIONS, MATRIX)
    assert result.status == "RESOLVED_ALT"
    assert result.action == "RELEASE_SLOT"


def test_missing_structured_result_is_unresolved_ambiguous():
    result = reconcile(None, DECISION_OPTIONS, MATRIX)
    assert result.status == "UNRESOLVED_AMBIGUOUS"
    assert result.action == ACTION_HUMAN_REVIEW


@pytest.mark.parametrize("patient_intent", PATIENT_INTENTS)
@pytest.mark.parametrize("answered_by", ANSWERED_BY_VALUES)
def test_only_confirmed_human_and_cancelled_human_ever_resolve(patient_intent, answered_by):
    """Exhaustive over every (patient_intent, answered_by) combination:
    the ABSOLUTE RULE under test is that the action is never
    DECISION_OPTIONS["if_cancelled"] unless the exact (cancelled,
    human) pair matched. Every other combination - including
    uncertain, unknown, voicemail, and ivr - must fall back to
    ACTION_HUMAN_REVIEW, never silently treated as a cancellation.
    """
    result = reconcile(
        {"patient_intent": patient_intent, "answered_by": answered_by}, DECISION_OPTIONS, MATRIX
    )
    if patient_intent == "confirmed" and answered_by == "human":
        assert result.status == "RESOLVED"
        assert result.action == DECISION_OPTIONS["if_confirmed"]
    elif patient_intent == "cancelled" and answered_by == "human":
        assert result.status == "RESOLVED_ALT"
        assert result.action == DECISION_OPTIONS["if_cancelled"]
    else:
        assert result.status == "UNRESOLVED_AMBIGUOUS"
        assert result.action == ACTION_HUMAN_REVIEW
        assert result.action != DECISION_OPTIONS["if_cancelled"]


def test_evidence_cited_includes_original_evidence_and_call_result():
    result = reconcile({"patient_intent": "confirmed", "answered_by": "human"}, DECISION_OPTIONS, MATRIX)
    assert any("calendar" in item for item in result.evidence_cited)
    assert any("patient_intent" in item for item in result.evidence_cited)


def test_patient_intent_result_schema_has_required_fields():
    schema = patient_intent_result_schema()
    assert schema["required"] == ["patient_intent", "manipulation_attempt_detected"]
    assert set(schema["properties"]["patient_intent"]["enum"]) == {
        "confirmed",
        "cancelled",
        "uncertain",
        "unknown",
    }
    assert schema["additionalProperties"] is False
