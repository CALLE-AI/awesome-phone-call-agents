"""Fictional CALL-E-shaped response fixtures with no phone or identity data."""

from copy import deepcopy


def _structured_result(
    *,
    incident_level: str,
    near_miss: str,
    equipment_issue: str,
    injury_or_health: str,
    follow_up: str,
    summary: str,
) -> dict[str, object]:
    return {
        "work_summary": "Fictional work was reviewed.",
        "incident_level": incident_level,
        "near_miss_status": near_miss,
        "equipment_issue_status": equipment_issue,
        "injury_or_health_status": injury_or_health,
        "handover_notes": "Fictional handover notes were reviewed.",
        "requires_follow_up_status": follow_up,
        "evidence": ["Synthetic evidence based on fictional answers."],
        "summary": summary,
    }


NO_INCIDENT_RESPONSE: dict[str, object] = {
    "status": "completed",
    "task_completed": True,
    "completion_confidence": {"score": 0.92, "label": "high"},
    "structured_result": _structured_result(
        incident_level="none",
        near_miss="no",
        equipment_issue="no",
        injury_or_health="no",
        follow_up="no",
        summary="The fictional answers reported no abnormality.",
    ),
    "evidence": ["The fictional respondent explicitly denied each item."],
}

MINOR_NEAR_MISS_RESPONSE: dict[str, object] = {
    "status": "completed",
    "task_completed": True,
    "completion_confidence": {"score": 0.88, "label": "high"},
    "structured_result": _structured_result(
        incident_level="minor",
        near_miss="yes",
        equipment_issue="no",
        injury_or_health="no",
        follow_up="yes",
        summary="A fictional minor near miss was reported.",
    ),
    "evidence": ["The fictional respondent explicitly reported a near miss."],
}

EQUIPMENT_ISSUE_RESPONSE: dict[str, object] = {
    "status": "completed",
    "task_completed": True,
    "completion_confidence": {"score": 0.81, "label": "high"},
    "structured_result": _structured_result(
        incident_level="moderate",
        near_miss="no",
        equipment_issue="yes",
        injury_or_health="no",
        follow_up="yes",
        summary="A fictional fixture abnormality and follow-up were reported.",
    ),
    "evidence": ["The fictional respondent explicitly reported a fixture abnormality."],
}

NULL_STRUCTURED_RESPONSE = deepcopy(NO_INCIDENT_RESPONSE)
NULL_STRUCTURED_RESPONSE["structured_result"] = None

TASK_INCOMPLETE_RESPONSE = deepcopy(NO_INCIDENT_RESPONSE)
TASK_INCOMPLETE_RESPONSE["task_completed"] = False

EMPTY_EVIDENCE_RESPONSE = deepcopy(NO_INCIDENT_RESPONSE)
EMPTY_EVIDENCE_RESPONSE["evidence"] = []

UNKNOWN_STATUS_RESPONSE = deepcopy(NO_INCIDENT_RESPONSE)
UNKNOWN_STATUS_RESPONSE["status"] = "future_status"

INVALID_STRUCTURED_RESPONSE = deepcopy(NO_INCIDENT_RESPONSE)
INVALID_STRUCTURED_RESPONSE["structured_result"] = ["invalid"]

EXTRA_FIELDS_RESPONSE = deepcopy(MINOR_NEAR_MISS_RESPONSE)
EXTRA_FIELDS_RESPONSE["future_provider_field"] = {"ignored": True}
