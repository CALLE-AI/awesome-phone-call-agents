"""Hold derivation, the cost governor, bundling, and the deadline guardrail."""
from __future__ import annotations

from datetime import date, timedelta

from tests.helpers import context, seed
from trunkline import hold, policy, workqueue
from trunkline.models import QUEUED


def turns(*offsets):
    return [{"offset_seconds": value, "speaker": "user", "text": "x"} for value in offsets]


def test_a_long_silence_is_hold_and_a_short_one_is_not():
    profile = hold.derive(turns(0, 10, 1200, 1210))
    assert profile.hold_seconds == 1190
    assert profile.talk_seconds == 20
    assert len(profile.segments) == 1


def test_two_queues_are_both_counted():
    profile = hold.derive(turns(0, 900, 910, 1500, 1510))
    assert profile.hold_seconds == 900 + 590
    assert len(profile.segments) == 2


def test_a_representative_pausing_to_look_something_up_is_not_hold():
    profile = hold.derive(turns(0, 30, 60, 90))
    assert profile.hold_seconds == 0


def test_a_call_with_one_turn_has_no_hold():
    assert hold.derive(turns(0)).hold_seconds == 0
    assert hold.derive([]).total_seconds == 0


def test_duration_formatting():
    assert hold.format_duration(1420) == "23m 40s"
    assert hold.format_duration(3725) == "1h 02m 05s"


def test_cost_cap_refuses_a_call_worth_less_than_the_call():
    assert hold.cost_cap_exceeded(claim_value_usd=8.0, projected_cost_usd=2.26)
    assert not hold.cost_cap_exceeded(claim_value_usd=300.0, projected_cost_usd=2.26)
    assert hold.cost_cap_exceeded(claim_value_usd=0.0, projected_cost_usd=0.01)


def test_bundling_reduces_call_count(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    bundles = workqueue.build_bundles(ctx.ledger)
    saving = workqueue.bundling_saving(bundles)
    assert saving["claims"] == 10
    assert saving["calls"] < saving["claims"]
    assert saving["calls_avoided"] >= 3


def test_a_bundle_never_exceeds_the_payer_cap(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    for bundle in workqueue.build_bundles(ctx.ledger):
        cap = ctx.ledger.payer(bundle.payer_id).claims_per_call_cap
        assert len(bundle.claims) <= cap


def test_a_bundle_holds_one_payer_and_one_workflow(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    for bundle in workqueue.build_bundles(ctx.ledger):
        assert len({c.payer_id for c in bundle.claims}) == 1
        assert len({c.workflow for c in bundle.claims}) == 1


def test_the_deadline_guardrail_outranks_claim_value(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    workqueue.rescore(ctx.ledger)
    bundles = workqueue.build_bundles(ctx.ledger)
    assert bundles[0].urgent, "a claim near its filing deadline must be called first"


def test_a_claim_past_its_deadline_is_not_callable(tmp_path):
    data = str(tmp_path)
    seed(data)
    ctx = context(data)
    claim = ctx.ledger.claims[0]
    claim.filing_deadline = (date.today() - timedelta(days=1)).isoformat()
    assert claim.id not in [c.id for c in workqueue.callable_claims(ctx.ledger)]
    assert workqueue.score_claim(claim) == 0.0


def test_priority_rises_as_the_deadline_approaches():
    assert workqueue.urgency_multiplier(5) > workqueue.urgency_multiplier(20)
    assert workqueue.urgency_multiplier(20) > workqueue.urgency_multiplier(45)
    assert workqueue.urgency_multiplier(0) == 0.0
