"""Every row of decide()'s table, plus the two inversions that define the product:
silence is a finding, and an unknown never resolves optimistically."""
from __future__ import annotations

import pytest

from app.calls.contract import HazardView, NeighbourView, compile_contract
from app.domain.risk import RiskBand
from app.domain.state import CheckOutcome
from app.orchestrator.decide import PRIORITY, DecisionResult, decide, priority_for, read_risk

HEAT_HARD = ["checks.too_hot", "checks.has_power", "checks.has_water"]
OUTAGE_HARD = ["checks.has_power", "checks.equipment_working", "checks.has_medication"]


def result(**over):  # noqa: ANN001, ANN201
    """A schema-shaped result where everything is fine, so each test states only its own difference."""
    checks = {"too_hot": "no", "has_power": "yes", "has_water": "yes", **over.pop("checks", {})}
    base = {
        "reached_intended_person": "yes",
        "is_safe_now": "yes",
        "needs_help_now": "no",
        "sounded_distressed": "no",
        "checks": checks,
        "help_offers_stated": "yes",
        "help_accepted": [],
        "help_declined": [],
        "concerns": [],
        "alarming_quote": "",
        "call_back_requested": "no",
    }
    base.update(over)
    return base


def risk(band: RiskBand, hours: float | None = None) -> dict:
    return {"band": band.value, "time_to_harm_h": hours, "score": 0, "reasons": []}


# ---------------------------------------------------------------------------------- silence
@pytest.mark.parametrize("status", ["NO_ANSWER", "FAILED", "INVALID_RESULT", "PENDING", "DIALING", ""])
def test_any_status_but_completed_is_unreachable(status: str) -> None:
    """The inversion. In ShiftFill these never reached decide(); here they must, and they must not
    raise, must not be SAFE, and must carry an outcome the board can show."""
    d = decide(status=status, result=None, risk=risk(RiskBand.ROUTINE), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.UNREACHABLE
    assert d.escalates
    assert d.reason


def test_unreachable_walter_outranks_everything_else_on_the_board() -> None:
    """An unanswered call to a critical-band neighbour mid-outage is the top line of the evening —
    above an unanswered routine call, and above every reached-and-in-trouble neighbour."""
    walter = decide(status="NO_ANSWER", result=None, risk=risk(RiskBand.CRITICAL, 2.0), hard_fields=OUTAGE_HARD)
    routine = decide(status="NO_ANSWER", result=None, risk=risk(RiskBand.ROUTINE), hard_fields=HEAT_HARD)
    urgent_high = decide(status="COMPLETED", result=result(is_safe_now="no"), risk=risk(RiskBand.HIGH))

    assert walter.outcome is routine.outcome is CheckOutcome.UNREACHABLE
    assert walter.priority > routine.priority
    assert walter.priority > urgent_high.priority
    assert walter.priority == max(p for by_band in PRIORITY.values() for p in by_band.values())
    assert "critical band" in walter.reason and "2h from harm" in walter.reason


def test_unreachable_reason_names_the_status_not_a_generic_error() -> None:
    assert "nobody answered" in decide(status="NO_ANSWER", result=None).reason
    assert "failed to connect" in decide(status="FAILED", result=None).reason
    assert "no usable result" in decide(status="INVALID_RESULT", result=None).reason


def test_completed_with_no_structured_result_is_unreachable() -> None:
    d = decide(status="COMPLETED", result=None, risk=risk(RiskBand.HIGH))
    assert d.outcome is CheckOutcome.UNREACHABLE
    assert "no schema-valid result" in d.reason


def test_voicemail_is_unreachable_and_records_what_was_never_established() -> None:
    d = decide(status="COMPLETED",
               result=result(reached_intended_person="no", is_safe_now="unknown",
                             checks={"too_hot": "unknown", "has_power": "unknown", "has_water": "unknown"}),
               risk=risk(RiskBand.HIGH), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.UNREACHABLE
    assert "voicemail" in d.reason
    assert set(d.unresolved) == set(HEAT_HARD)


def test_could_not_tell_who_answered_is_also_unreachable() -> None:
    d = decide(status="COMPLETED", result=result(reached_intended_person="unknown"), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.UNREACHABLE


# ---------------------------------------------------------------------------------- alarms
def test_daughter_answers_to_say_she_is_on_the_floor() -> None:
    """The ordering that matters: the alarm checks run before the reached-them gate, so a relative
    reporting an emergency is URGENT and not filed as 'we did not reach her'."""
    d = decide(status="COMPLETED",
               result=result(reached_intended_person="no", is_safe_now="no",
                             alarming_quote="Mom's on the floor and I can't lift her.",
                             concerns=["she's been down since lunchtime"]),
               risk=risk(RiskBand.ELEVATED), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.URGENT
    assert d.last_words == "Mom's on the floor and I can't lift her."
    assert d.concerns == ["she's been down since lunchtime"]


def test_life_support_stopped_is_urgent_at_any_band() -> None:
    d = decide(status="COMPLETED",
               result=result(checks={"equipment_working": "no", "has_power": "no"},
                             equipment_hours_remaining="the battery's nearly gone"),
               risk=risk(RiskBand.ROUTINE), hard_fields=OUTAGE_HARD)
    assert d.outcome is CheckOutcome.URGENT
    assert "medical equipment" in d.reason
    assert "battery's nearly gone" in d.reason


def test_i_am_fine_does_not_survive_a_dead_cooler() -> None:
    """ShiftFill's contradiction rule, ported. There it bought a human review; there is no hold here,
    so it resolves pessimistically and the reason says out loud that they claimed to be safe."""
    d = decide(status="COMPLETED",
               result=result(is_safe_now="yes", checks={"too_hot": "yes"},
                             concerns=["my cooler quit yesterday"]),
               risk=risk(RiskBand.CRITICAL, 3.0), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.URGENT
    assert d.reason.startswith("they told us they were safe, but")
    assert "dangerously hot" in d.reason


def test_confusion_is_urgent_and_not_softened_by_their_own_reassurance() -> None:
    """Somebody who cannot follow the conversation cannot self-report, so 'I'm fine' from them is
    not evidence. Confusion is also itself a symptom of heat illness and hypoxia."""
    d = decide(status="COMPLETED", result=result(sounded_distressed="yes"),
               risk=risk(RiskBand.ROUTINE), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.URGENT
    assert "confused" in d.reason


def test_unknown_distress_does_not_make_every_call_urgent() -> None:
    """The guard on 'yes' only. A voicemail returns 'unknown' here and must not trip the alarm."""
    d = decide(status="COMPLETED", result=result(sounded_distressed="unknown"),
               risk=risk(RiskBand.ROUTINE), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.SAFE


def test_critical_band_turns_any_hazard_negative_into_urgent() -> None:
    critical = decide(status="COMPLETED", result=result(checks={"has_water": "no"}),
                      risk=risk(RiskBand.CRITICAL, 4.0), hard_fields=HEAT_HARD)
    elevated = decide(status="COMPLETED", result=result(checks={"has_water": "no"}),
                      risk=risk(RiskBand.ELEVATED), hard_fields=HEAT_HARD)
    assert critical.outcome is CheckOutcome.URGENT
    assert elevated.outcome is CheckOutcome.NEEDS_HELP  # same call, different person: not the same event


def test_living_alone_is_context_not_a_need() -> None:
    """someone_with_them == 'no' is most of this roster's normal Tuesday. A well person on their own
    must still come out of a sweep SAFE, with the fact recorded."""
    d = decide(status="COMPLETED", result=result(checks={"someone_with_them": "no"}),
               risk=risk(RiskBand.ELEVATED), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.SAFE
    assert any("nobody is with them" in f for f in d.findings)


# ---------------------------------------------------------------------------------- needs
def test_accepted_help_is_needs_help() -> None:
    d = decide(status="COMPLETED",
               result=result(needs_help_now="yes", help_accepted=["water_drop"],
                             concerns=["I'm nearly out of water"]),
               risk=risk(RiskBand.HIGH), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.NEEDS_HELP
    assert d.help_accepted == ["water_drop"]


def test_declined_help_is_recorded_as_their_decision_not_overridden() -> None:
    d = decide(status="COMPLETED",
               result=result(needs_help_now="yes", help_declined=["cooling_center"]),
               risk=risk(RiskBand.HIGH), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.HELP_DECLINED
    assert "turned down cooling_center" in d.reason
    assert d.escalates  # their refusal is theirs to make; it still stays on the captain's board


def test_accepting_one_offer_outweighs_declining_another() -> None:
    d = decide(status="COMPLETED",
               result=result(needs_help_now="yes", help_accepted=["ride"], help_declined=["cooling_center"]),
               hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.NEEDS_HELP


def test_a_need_with_nothing_offered_says_so() -> None:
    d = decide(status="COMPLETED",
               result=result(needs_help_now="yes", help_offers_stated="no"),
               hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.NEEDS_HELP
    assert "no help was offered" in d.reason


def test_needs_help_no_does_not_erase_a_negative_check() -> None:
    """Never resolve a contradiction optimistically: 'I don't need anything' alongside 'no water' is
    still a need."""
    d = decide(status="COMPLETED", result=result(needs_help_now="no", checks={"has_water": "no"}),
               risk=risk(RiskBand.ELEVATED), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.NEEDS_HELP
    assert "no safe drinking water" in d.reason


# ---------------------------------------------------------------------------------- the residue
def test_unknown_hazard_fact_is_never_safe_and_is_band_conditioned() -> None:
    unknown_cooler = result(checks={"too_hot": "unknown"})
    high = decide(status="COMPLETED", result=unknown_cooler, risk=risk(RiskBand.HIGH), hard_fields=HEAT_HARD)
    routine = decide(status="COMPLETED", result=unknown_cooler, risk=risk(RiskBand.ROUTINE), hard_fields=HEAT_HARD)
    assert high.outcome is CheckOutcome.URGENT
    assert routine.outcome is CheckOutcome.NEEDS_HELP
    for d in (high, routine):
        assert d.unresolved == ["checks.too_hot"]
        # The captain must be able to tell "we don't know" from "she asked for something".
        assert "could not establish too hot" in d.reason
        assert "they need" not in d.reason


def test_low_calle_confidence_blocks_safe() -> None:
    d = decide(status="COMPLETED", result=result(), risk=risk(RiskBand.ROUTINE), hard_fields=HEAT_HARD,
               completion_confidence={"label": "low", "score": 0.2})
    assert d.outcome is CheckOutcome.NEEDS_HELP
    assert "low confidence" in d.reason


def test_schema_validation_failure_blocks_safe() -> None:
    d = decide(status="COMPLETED", result=result(), risk=risk(RiskBand.ROUTINE), hard_fields=HEAT_HARD,
               validation_errors=["checks/has_power: 'maybe' is not one of ['yes', 'no', 'unknown']"])
    assert d.outcome is CheckOutcome.NEEDS_HELP
    assert "failed schema validation" in d.reason


def test_everything_established_and_nothing_wrong_is_safe() -> None:
    d = decide(status="COMPLETED", result=result(), risk=risk(RiskBand.CRITICAL, 1.0), hard_fields=HEAT_HARD)
    assert d.outcome is CheckOutcome.SAFE
    assert not d.escalates
    assert d.priority == PRIORITY[CheckOutcome.SAFE][RiskBand.CRITICAL]


# ---------------------------------------------------------------------------------- inputs
def test_missing_triage_degrades_to_elevated_never_routine() -> None:
    """Not having scored someone is not evidence they are fine, and must not be the reason their
    unanswered call sorts to the bottom of the board."""
    band, hours, note = read_risk(None)
    assert band is RiskBand.ELEVATED and hours is None and note
    d = decide(status="NO_ANSWER", result=None)
    assert d.band is RiskBand.ELEVATED
    assert d.priority > priority_for(CheckOutcome.UNREACHABLE, RiskBand.ROUTINE)
    assert any("no triage on file" in f for f in d.findings)


def test_junk_triage_degrades_rather_than_raising() -> None:
    assert read_risk({"band": "purple"})[0] is RiskBand.ELEVATED
    assert decide(status="NO_ANSWER", result=None, risk={"band": "purple"}).outcome is CheckOutcome.UNREACHABLE


def test_risk_assessment_object_and_dict_agree() -> None:
    from app.domain.hazards import HazardKind, Severity
    from app.domain.risk import RiskAssessment

    obj = RiskAssessment(neighbour_id="n1", name="Walter", hazard_id="h1", hazard_kind=HazardKind.POWER_OUTAGE,
                         severity=Severity.WARNING, score=80, band=RiskBand.CRITICAL, time_to_harm_h=2.0)
    from_obj = decide(status="NO_ANSWER", result=None, risk=obj)
    from_dict = decide(status="NO_ANSWER", result=None, risk=obj.to_dict())
    assert from_obj.priority == from_dict.priority == priority_for(CheckOutcome.UNREACHABLE, RiskBand.CRITICAL)


def test_garbage_result_never_raises_and_never_returns_safe() -> None:
    """A decide() that throws means a call lands with no outcome at all, which is the one state this
    product may never produce."""
    for junk in ({}, {"checks": "not-an-object"}, {"is_safe_now": 7, "concerns": "nope", "help_accepted": {}},
                 {"reached_intended_person": None}):
        d = decide(status="COMPLETED", result=junk, risk=risk(RiskBand.HIGH), hard_fields=HEAT_HARD)
        assert isinstance(d, DecisionResult)
        assert d.outcome is not CheckOutcome.SAFE


def test_decide_reads_the_real_compiled_contract() -> None:
    """The hard_fields decide() gates on are whatever the contract compiled for this hazard and this
    person — no hand-maintained second list that can drift from the schema."""
    contract = compile_contract(
        HazardView(kind="power_outage", headline="Power outage — 6h estimate", area="Maryvale", severity="warning"),
        NeighbourView(name="Walter Diaz", power_dependent=True, power_backup_hours=2.0, lives_alone=True),
    )
    assert "checks.equipment_working" in contract.hard_fields
    d = decide(status="COMPLETED",
               result=result(checks={"equipment_working": "unknown", "has_power": "no", "has_medication": "yes"}),
               risk=risk(RiskBand.CRITICAL, 2.0), hard_fields=contract.hard_fields)
    # has_power == "no" during an outage is not a failed requirement, it is the expected finding; the
    # critical band is what makes it urgent, and the unanswered equipment question is carried along.
    assert d.outcome is CheckOutcome.URGENT
    assert d.checks["checks.has_power"] == "no"


def test_decision_result_is_json_safe_for_the_event_bus() -> None:
    import json

    d = decide(status="COMPLETED", result=result(is_safe_now="no", alarming_quote="I can't get up."),
               risk=risk(RiskBand.CRITICAL, 1.5), hard_fields=HEAT_HARD)
    payload = json.loads(json.dumps(d.to_dict()))
    assert payload["outcome"] == "URGENT" and payload["band"] == "critical" and payload["escalates"] is True
