"""Test fixtures. No CALL-E credentials and no phone calls: everything here
runs offline against fictional +1 555 01xx numbers."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("CALLE_API_KEY", "iams_test_placeholder")
os.environ.setdefault("CALLE_BASE_URL", "https://api.heycall-e.com")
os.environ.setdefault("REFCHECK_WEBHOOK_TOKEN", "test-token")

import pytest  # noqa: E402


CANDIDATE = {
    "id": "cand-1",
    "name": "Alex Candidate",
    "role_applied_for": "Senior Software Engineer",
    "company_name": "Northwind",
    "job_description_summary": "Owns the payments platform.",
}

REFERENCE = {
    "id": "ref-1",
    "candidate_id": "cand-1",
    "referee_name": "Jordan Referee",
    "referee_phone": "+15555550142",
    "relationship": "Former direct manager",
}

QUESTIONS = [
    {"id": "q_relationship", "text": "How did you work with {candidate_name}?", "type": "open"},
    {
        "id": "q_strengths",
        "text": "What are {candidate_name}'s greatest strengths?",
        "type": "open",
        "follow_up": "Can you give a specific example?",
    },
    {"id": "q_rehire", "text": "Would you hire {candidate_name} again?", "type": "boolean"},
    {
        "id": "q_fit",
        "text": "We are considering them for a {role} role involving {jd_summary}. Thoughts?",
        "type": "open",
    },
]


@pytest.fixture
def candidate():
    return dict(CANDIDATE)


@pytest.fixture
def reference():
    return dict(REFERENCE)


@pytest.fixture
def questions():
    return [dict(q) for q in QUESTIONS]


def make_call(
    *,
    call_id="call_abc123",
    status="completed",
    structured_result=None,
    reference_id="ref-1",
    turns=None,
    provider_call_id="provider_001",
    started_at="2026-06-08T18:21:00Z",
    completed_at="2026-06-08T18:29:00Z",
):
    """A terminal call-task snapshot shaped like GET /v1/calls/{call_id}."""
    return {
        "id": call_id,
        "object": "call_task",
        "status": status,
        "structured_result": structured_result,
        "summary": "Reference call summary.",
        "task_completed": status == "completed",
        "completion_confidence": {"score": 0.9, "label": "high"},
        "evidence": ["The referee answered the questions."],
        "metadata": {"reference_id": reference_id, "candidate_id": "cand-1"},
        "recipients": [
            {
                "id": "rcp_001",
                "phones": ["+15555550142"],
                "status": status,
                "structured_result": None,
                "summary": "Spoke with the referee.",
                "attempts": [
                    {
                        "id": "att_001",
                        "phone": "+15555550142",
                        "status": status,
                        "started_at": started_at,
                        "completed_at": completed_at,
                        "provider_call_id": provider_call_id,
                        "failure_code": None,
                        "failure_message": None,
                        "transcript_turns": turns
                        if turns is not None
                        else [
                            {"offset_seconds": 0, "speaker": "bot", "text": "Is this Jordan?"},
                            {"offset_seconds": 4, "speaker": "user", "text": "Speaking."},
                        ],
                    }
                ],
            }
        ],
        "failure_code": None,
        "failure_message": None,
        "created_at": "2026-06-08T18:20:00Z",
        "completed_at": completed_at,
    }


def full_result(**overrides):
    """A schema-valid structured_result for the 4-question fixture template."""
    base = {
        "spoke_with_referee": "yes",
        "call_outcome": "completed",
        "referee_enthusiasm": "very_enthusiastic",
        "would_rehire": "yes",
        "answers": {
            "q_relationship": {"response": "Managed them for three years.", "rating": "4"},
            "q_strengths": {"response": "Owned the payments migration.", "rating": "5"},
            "q_rehire": {"response": "Absolutely, first call I make.", "rating": "5"},
            "q_fit": {"response": "Strong fit.", "rating": "5"},
        },
        "strengths": ["Owned the payments migration end-to-end"],
        "red_flags": [],
        "notable_quotes": ["They are the first call I make."],
        "summary": "Extremely strong reference.",
    }
    base.update(overrides)
    return base
