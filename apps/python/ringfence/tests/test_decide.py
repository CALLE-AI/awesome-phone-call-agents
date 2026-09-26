from ringfence import decide as decide_mod
from ringfence import resolve

_CLEAN_SIGNALS = {
    "secrecy_demand_present": False,
    "urgency_pressure_present": False,
    "relationship_explained": True,
    "irreversible_payment_demanded": False,
    "explicit_hold_requested": False,
}


def _resolution(outcome: str) -> resolve.Resolution:
    return resolve.Resolution(outcome=outcome, confidence="high", evidence=["test"])


def test_explicit_hold_always_blocks_even_with_otherwise_clean_signals():
    signals = dict(_CLEAN_SIGNALS, explicit_hold_requested=True)
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition == decide_mod.ADVISE_BLOCK
    assert "explicit_hold_requested" in result.reasons


def test_secrecy_demand_blocks():
    signals = dict(_CLEAN_SIGNALS, secrecy_demand_present=True)
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition == decide_mod.ADVISE_BLOCK


def test_urgency_pressure_blocks():
    signals = dict(_CLEAN_SIGNALS, urgency_pressure_present=True)
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition == decide_mod.ADVISE_BLOCK


def test_unexplained_relationship_blocks():
    signals = dict(_CLEAN_SIGNALS, relationship_explained=False)
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition == decide_mod.ADVISE_BLOCK


def test_irreversible_payment_demanded_blocks():
    signals = dict(_CLEAN_SIGNALS, irreversible_payment_demanded=True)
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition == decide_mod.ADVISE_BLOCK


def test_multiple_red_flags_all_reported():
    signals = dict(
        _CLEAN_SIGNALS,
        secrecy_demand_present=True,
        urgency_pressure_present=True,
    )
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition == decide_mod.ADVISE_BLOCK
    assert "secrecy_demand_present" in result.reasons
    assert "urgency_pressure_present" in result.reasons


def test_unresolved_ambiguous_escalates_never_allows():
    result = decide_mod.decide(_resolution(resolve.UNRESOLVED_AMBIGUOUS), _CLEAN_SIGNALS)
    assert result.disposition == decide_mod.ESCALATE_TO_HUMAN


def test_no_answer_confirmed_escalates_never_allows():
    result = decide_mod.decide(_resolution(resolve.NO_ANSWER_CONFIRMED), _CLEAN_SIGNALS)
    assert result.disposition == decide_mod.ESCALATE_TO_HUMAN


def test_rejected_before_ring_escalates_never_allows():
    result = decide_mod.decide(_resolution(resolve.REJECTED_BEFORE_RING), _CLEAN_SIGNALS)
    assert result.disposition == decide_mod.ESCALATE_TO_HUMAN


def test_clean_conversation_with_explicit_confirmation_allows():
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), _CLEAN_SIGNALS)
    assert result.disposition == decide_mod.ADVISE_ALLOW


def test_missing_signals_never_allow():
    # No signals at all (e.g. a malformed/incomplete result) must fail
    # closed, not be read as "clean."
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), {})
    assert result.disposition != decide_mod.ADVISE_ALLOW


def test_missing_secrecy_signal_alone_never_allows():
    # Only relationship_explained/explicit_hold_requested being clean is not
    # enough — every signal ALLOW depends on must be affirmatively present.
    signals = dict(_CLEAN_SIGNALS)
    del signals["secrecy_demand_present"]
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition != decide_mod.ADVISE_ALLOW


def test_missing_urgency_signal_alone_never_allows():
    signals = dict(_CLEAN_SIGNALS)
    del signals["urgency_pressure_present"]
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition != decide_mod.ADVISE_ALLOW


def test_missing_irreversible_payment_signal_alone_never_allows():
    signals = dict(_CLEAN_SIGNALS)
    del signals["irreversible_payment_demanded"]
    result = decide_mod.decide(_resolution(resolve.ANSWERED_SUCCESS), signals)
    assert result.disposition != decide_mod.ADVISE_ALLOW


def test_decide_checks_every_signal_declared_in_result_schema():
    # Tripwire against decide.py silently drifting out of sync with
    # verify_call.RESULT_SCHEMA if a new signal field is ever added there.
    import inspect

    from ringfence.verify_call import RESULT_SCHEMA

    source = inspect.getsource(decide_mod.decide)
    for field in RESULT_SCHEMA["required"]:
        assert field in source, f"decide() never reads {field!r} from RESULT_SCHEMA"


def test_answered_declined_falls_to_escalate_not_allow():
    result = decide_mod.decide(_resolution(resolve.ANSWERED_DECLINED), _CLEAN_SIGNALS)
    assert result.disposition == decide_mod.ESCALATE_TO_HUMAN


def test_policy_or_content_refusal_falls_to_escalate_not_allow():
    result = decide_mod.decide(_resolution(resolve.POLICY_OR_CONTENT_REFUSAL), _CLEAN_SIGNALS)
    assert result.disposition == decide_mod.ESCALATE_TO_HUMAN


def test_every_recommendation_is_advisory_and_requires_human_review():
    # The whole module is advisory by construction: no input produces a
    # value an integrator may act on without a human. Covers every branch
    # decide() can return through.
    cases = [
        (resolve.ANSWERED_SUCCESS, _CLEAN_SIGNALS),                                    # ADVISE_ALLOW
        (resolve.ANSWERED_SUCCESS, dict(_CLEAN_SIGNALS, secrecy_demand_present=True)),  # ADVISE_BLOCK
        (resolve.ANSWERED_SUCCESS, dict(_CLEAN_SIGNALS, explicit_hold_requested=True)),  # ADVISE_BLOCK (hold)
        (resolve.NO_ANSWER_CONFIRMED, _CLEAN_SIGNALS),                                  # ESCALATE (unresolved)
        (resolve.ANSWERED_SUCCESS, {}),                                                 # ESCALATE (fallback)
    ]
    seen = set()
    for outcome, signals in cases:
        result = decide_mod.decide(_resolution(outcome), signals)
        seen.add(result.disposition)
        assert result.advisory is True
        assert result.requires_human_review is True
        as_dict = result.as_dict()
        assert as_dict["advisory"] is True
        assert as_dict["requires_human_review"] is True
    assert seen == set(decide_mod.RECOMMENDATIONS)


def test_no_recommendation_is_named_like_an_executable_financial_action():
    # ALLOW/BLOCK read as instructions to release or freeze money; these
    # values are recommendations about a phone call, and are named so.
    for recommendation in decide_mod.RECOMMENDATIONS:
        assert recommendation not in ("ALLOW", "BLOCK", "APPROVE", "DENY")
        assert recommendation.startswith(("ADVISE_", "ESCALATE_"))
