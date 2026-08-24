"""Regressions for the cascade. Each one guards a way the search could go wrong."""

from __future__ import annotations

import json
import pathlib

import pytest

from cascade import (
    Candidate,
    CallReport,
    Concession,
    Criterion,
    Kind,
    NumberRejected,
    Outcome,
    Request,
    Verdict,
    intent_key,
    judge,
    load_fixture,
    main,
    mask,
    order_candidates,
    render,
    run_cascade,
)

FIXTURE = pathlib.Path(__file__).parent / "example-restaurants.json"


def simple_request(**overrides) -> Request:
    criteria = overrides.pop(
        "criteria",
        (
            Criterion("delivers", Kind.MUST, "Delivers tonight"),
            Criterion("price", Kind.BOUNDARY, "Total price", limit=45.0),
        ),
    )
    concessions = overrides.pop(
        "concessions",
        (
            Concession("pickup_ok", "We can collect it.", tier=1),
            Concession("surcharge_ok", "A surcharge is acceptable.", tier=2),
        ),
    )
    return Request(subject="dinner", criteria=criteria, concessions=concessions)


def accepted(candidate_id: str, price: float = 40.0, **kw) -> CallReport:
    return CallReport(
        candidate_id=candidate_id,
        outcome=Outcome.ACCEPTED,
        values={"price": price},
        satisfied=kw.pop("satisfied", ("delivers",)),
        **kw,
    )


# -- the cascade stops -------------------------------------------------------------------


def test_cascade_stops_at_the_first_accepted_candidate():
    request = simple_request()
    candidates = [
        Candidate("a", "First", "+15550100011", rank_hint=3.0),
        Candidate("b", "Second", "+15550100022", rank_hint=2.0),
        Candidate("c", "Third", "+15550100033", rank_hint=1.0),
    ]
    reports = {c.id: accepted(c.id) for c in candidates}

    result = run_cascade(request, candidates, reports)

    assert result.closed_by == "First"
    assert [a.verdict for a in result.attempts] == [
        Verdict.ACCEPTED,
        Verdict.NOT_CALLED,
        Verdict.NOT_CALLED,
    ]


def test_remaining_candidates_are_not_processed_after_a_close():
    """A not-called candidate must carry no verdict of its own -- not even a good one."""
    request = simple_request()
    candidates = [
        Candidate("a", "First", "+15550100011", rank_hint=3.0),
        Candidate("b", "Second", "+15550100022", rank_hint=2.0),
    ]
    # The second candidate would have been rejected. It must still read not_called.
    reports = {"a": accepted("a"), "b": accepted("b", price=999.0)}

    result = run_cascade(request, candidates, reports)

    second = result.attempts[1]
    assert second.verdict is Verdict.NOT_CALLED
    assert second.reasons == []
    assert second.intent_key == ""


def test_candidates_are_ordered_deterministically_not_by_insertion():
    candidates = [
        Candidate("z", "Low rank", "+15550100011", rank_hint=1.0),
        Candidate("a", "High rank", "+15550100022", rank_hint=9.0),
        Candidate("m", "Tie one", "+15550100033", rank_hint=5.0),
        Candidate("b", "Tie two", "+15550100044", rank_hint=5.0),
    ]
    ordered = [c.id for c in order_candidates(candidates)]
    assert ordered == ["a", "b", "m", "z"]


# -- boundaries and musts ----------------------------------------------------------------


def test_boundary_is_hard_even_when_the_candidate_said_yes():
    request = simple_request()
    candidate = Candidate("a", "Over budget", "+15550100011")
    reports = {"a": accepted("a", price=45.01)}

    result = run_cascade(request, [candidate], reports)

    assert result.closed_by is None
    assert result.attempts[0].verdict is Verdict.REJECTED_BOUNDARY


def test_boundary_without_a_stated_value_is_not_assumed_to_be_fine():
    request = simple_request()
    report = CallReport("a", Outcome.ACCEPTED, values={}, satisfied=("delivers",))
    verdict, _ = judge(request, report)
    assert verdict is Verdict.REJECTED_BOUNDARY


def test_unmet_must_rejects_the_call():
    request = simple_request()
    report = CallReport("a", Outcome.ACCEPTED, values={"price": 10.0}, satisfied=())
    verdict, reasons = judge(request, report)
    assert verdict is Verdict.REJECTED_MUST
    assert "Delivers tonight" in reasons[0]


def test_unmet_wish_does_not_block():
    request = simple_request(
        criteria=(
            Criterion("delivers", Kind.MUST, "Delivers tonight"),
            Criterion("price", Kind.BOUNDARY, "Total price", limit=45.0),
            Criterion("stars", Kind.WISH, "Above four stars"),
        )
    )
    report = CallReport("a", Outcome.ACCEPTED, values={"price": 10.0}, satisfied=("delivers",))
    verdict, reasons = judge(request, report)
    assert verdict is Verdict.ACCEPTED
    assert any("wish" in r for r in reasons)


# -- concessions are a mandate -----------------------------------------------------------


def test_unauthorised_concession_is_rejected():
    """Buying the deal with authority nobody granted is not a success."""
    request = simple_request(concessions=(Concession("pickup_ok", "We collect.", tier=1),))
    report = accepted("a", tiers_used=("surcharge_ok",))

    verdict, reasons = judge(request, report)

    assert verdict is Verdict.REJECTED_MANDATE
    assert "never authorised" in reasons[0]


def test_a_later_tier_may_not_be_played_before_an_earlier_one():
    request = simple_request()
    report = accepted("a", tiers_used=("surcharge_ok",))

    verdict, reasons = judge(request, report)

    assert verdict is Verdict.REJECTED_ORDER
    assert "tier 1 was never tried" in reasons[0]


def test_tiers_in_order_are_accepted():
    request = simple_request()
    report = accepted("a", tiers_used=("pickup_ok", "surcharge_ok"))
    verdict, _ = judge(request, report)
    assert verdict is Verdict.ACCEPTED


def test_first_tier_alone_is_accepted():
    request = simple_request()
    report = accepted("a", tiers_used=("pickup_ok",))
    verdict, _ = judge(request, report)
    assert verdict is Verdict.ACCEPTED


# -- unknown outcomes --------------------------------------------------------------------


def test_unknown_outcome_halts_the_cascade():
    request = simple_request()
    candidates = [
        Candidate("a", "Unclear", "+15550100011", rank_hint=3.0),
        Candidate("b", "Would have worked", "+15550100022", rank_hint=2.0),
    ]
    reports = {"a": CallReport("a", Outcome.UNKNOWN), "b": accepted("b")}

    result = run_cascade(request, candidates, reports)

    assert result.halted is True
    assert result.closed_by is None
    assert result.attempts[1].verdict is Verdict.NOT_CALLED


def test_unknown_outcome_is_not_read_as_refusal_or_unreachability():
    request = simple_request()
    verdict, reasons = judge(request, CallReport("a", Outcome.UNKNOWN))
    assert verdict is Verdict.HALTED_UNKNOWN
    assert verdict is not Verdict.DECLINED
    assert verdict is not Verdict.NO_ANSWER
    assert "inventions" in reasons[0]


def test_a_missing_fixture_response_halts_rather_than_being_skipped():
    request = simple_request()
    candidates = [
        Candidate("a", "No entry", "+15550100011", rank_hint=3.0),
        Candidate("b", "Later", "+15550100022", rank_hint=2.0),
    ]
    result = run_cascade(request, candidates, {})
    assert result.halted is True
    assert result.attempts[1].verdict is Verdict.NOT_CALLED


def test_no_answer_and_declined_stay_apart():
    request = simple_request()
    assert judge(request, CallReport("a", Outcome.NO_ANSWER))[0] is Verdict.NO_ANSWER
    assert judge(request, CallReport("a", Outcome.DECLINED))[0] is Verdict.DECLINED


# -- numbers -----------------------------------------------------------------------------


def test_invalid_number_is_refused_before_processing():
    with pytest.raises(NumberRejected):
        Candidate("a", "Bad", "0170 1234567")
    with pytest.raises(NumberRejected):
        Candidate("a", "Empty", "")


@pytest.mark.parametrize("number", ["+15550100011", "+4915550100011"])
def test_mask_keeps_prefix_and_two_digits(number):
    masked = mask(number)
    assert masked.startswith(number[:3])
    assert masked.endswith(number[-2:])
    assert number not in masked


def test_no_full_number_appears_anywhere_in_the_output():
    request, candidates, reports = load_fixture(FIXTURE)
    result = run_cascade(request, candidates, reports)

    text = render(result) + json.dumps(result.to_dict())
    for candidate in candidates:
        assert candidate.phone not in text, candidate.phone
        assert mask(candidate.phone) in text


# -- the intent key ----------------------------------------------------------------------


def test_intent_key_is_stable_across_runs():
    request = simple_request()
    candidate = Candidate("a", "Same", "+15550100011")
    assert intent_key(request, candidate) == intent_key(request, candidate)


def test_intent_key_changes_with_the_content_of_the_intent():
    candidate = Candidate("a", "Same", "+15550100011")
    base = intent_key(simple_request(), candidate)

    tighter = simple_request(
        criteria=(
            Criterion("delivers", Kind.MUST, "Delivers tonight"),
            Criterion("price", Kind.BOUNDARY, "Total price", limit=30.0),
        )
    )
    fewer = simple_request(concessions=(Concession("pickup_ok", "We collect.", tier=1),))

    assert intent_key(tighter, candidate) != base
    assert intent_key(fewer, candidate) != base
    assert intent_key(simple_request(), Candidate("b", "Other", "+15550100022")) != base


# -- the shipped fixture -----------------------------------------------------------------


def test_the_shipped_fixture_tells_the_intended_story():
    request, candidates, reports = load_fixture(FIXTURE)
    result = run_cascade(request, candidates, reports)

    verdicts = {a.candidate.id: a.verdict for a in result.attempts}
    assert verdicts["trattoria-verde"] is Verdict.DECLINED
    assert verdicts["golden-wok"] is Verdict.REJECTED_BOUNDARY
    assert verdicts["pizzeria-nord"] is Verdict.ACCEPTED
    assert verdicts["curry-haus"] is Verdict.NOT_CALLED
    assert result.closed_by == "Pizzeria Nord"


def test_cli_runs_without_network_and_marks_the_run_as_simulated(capsys):
    assert main(["--fixture", str(FIXTURE)]) == 0
    out = capsys.readouterr().out
    assert "NO CALL PLACED" in out
    assert "Pizzeria Nord" in out


def test_cli_json_output_is_valid_and_marked(capsys):
    assert main(["--fixture", str(FIXTURE), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["mode"] == "fixture / simulated / no-call"
    assert payload["closed_by"] == "Pizzeria Nord"
    assert payload["not_called"] == 1
