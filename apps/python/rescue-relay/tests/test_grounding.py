import copy
import pytest
from coordinator import validate_analysis, build_coverage, PlannerUnavailable, demo_capabilities

DEFINITION = {"goal": "Arrange transport.", "requirements": [{"id": "transport", "label": "Transport", "reason": "The animal needs a ride."}]}
IDENTITY = "Yes, this is the trusted team and I represent them."
COMMITMENT = "I confirm I will transport the animal from that location in 20 minutes."
EVIDENCE = {"transcript": [{"speaker": "user", "text": IDENTITY}, {"speaker": "user", "text": COMMITMENT}]}
RAW = {"recipient_confirmed": "yes", "identity_quote": IDENTITY, "summary": "Transport agreed.",
       "assessments": [{"requirement_id": "transport", "status": "committed", "action": "Transport the animal.",
                        "evidence_quote": COMMITMENT, "eta_minutes": 20, "conditions": []}], "new_requirements": [], "next_step": "Check the remaining needs."}


def test_exact_recipient_quote_can_support_commitment():
    a = validate_analysis(copy.deepcopy(RAW), DEFINITION, EVIDENCE)
    assert a["assessments"][0]["status"] == "committed"


@pytest.mark.parametrize("change", ["fabricated", "agent_only", "no_identity", "no_transcript"])
def test_unverified_evidence_never_covers_need(change):
    r, ev = copy.deepcopy(RAW), copy.deepcopy(EVIDENCE)
    if change == "fabricated": r["assessments"][0]["evidence_quote"] = "I will fly the animal to safety in one minute."
    elif change == "agent_only": ev["transcript"][1]["speaker"] = "bot"
    elif change == "no_identity": r["identity_quote"] = "Fabricated identity confirmation"
    else: ev["transcript"] = []
    a = validate_analysis(r, DEFINITION, ev)
    assert a["assessments"][0]["status"] == "unknown"
    c = {"business_id": "biz_a", "business_name": "Team", "id": "call_a", "analysis": a}
    assert not build_coverage(DEFINITION, [c])["complete"]


def test_conditions_override_committed_label():
    r = copy.deepcopy(RAW)
    r["assessments"][0]["conditions"] = ["Only after manager approval."]
    assert validate_analysis(r, DEFINITION, EVIDENCE)["assessments"][0]["status"] == "conditional"


def test_unknown_requirement_id_rejected():
    r = copy.deepcopy(RAW); r["assessments"][0]["requirement_id"] = "invented"
    with pytest.raises(PlannerUnavailable): validate_analysis(r, DEFINITION, EVIDENCE)


def test_duplicate_assessment_rejected():
    r = copy.deepcopy(RAW); r["assessments"].append(copy.deepcopy(r["assessments"][0]))
    with pytest.raises(PlannerUnavailable): validate_analysis(r, DEFINITION, EVIDENCE)


def test_available_is_not_committed():
    r = copy.deepcopy(RAW); r["assessments"][0]["status"] = "available"
    a = validate_analysis(r, DEFINITION, EVIDENCE)
    c = {"business_id": "biz_a", "business_name": "Team", "id": "call_a", "analysis": a}
    assert build_coverage(DEFINITION, [c])["covered_count"] == 0


def test_demo_directory_negation_is_not_a_capability():
    assert "transport" not in demo_capabilities("A neighbor who can observe the animal. Cannot handle or transport it.")


def test_empty_requirement_set_never_complete():
    assert not build_coverage({"requirements": []}, [])["complete"]
