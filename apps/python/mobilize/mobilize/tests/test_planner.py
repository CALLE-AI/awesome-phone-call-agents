from mobilize.core.types import Candidate
from mobilize.core.planner import plan_wave, rank_candidates, should_dispatch_next_wave


def make_candidate(id_, accept=0.5, showup=0.5, eligible=True, distance=5.0, days=90) -> Candidate:
    return Candidate(
        id=id_,
        phone="+15550000000",
        name=id_,
        days_since_last_action=days,
        distance_km=distance,
        historical_accept_rate=accept,
        historical_showup_rate=showup,
        eligible=eligible,
    )


def test_rank_candidates_excludes_ineligible():
    pool = [make_candidate("a", eligible=True), make_candidate("b", eligible=False)]
    ranked = rank_candidates(pool)
    assert [c.id for c in ranked] == ["a"]


def test_rank_candidates_orders_by_prior_score_descending():
    strong = make_candidate("strong", accept=0.9, showup=0.9)
    weak = make_candidate("weak", accept=0.1, showup=0.1)
    ranked = rank_candidates([weak, strong])
    assert [c.id for c in ranked] == ["strong", "weak"]


def test_plan_wave_stops_once_expected_meets_target():
    pool = [make_candidate(f"c{i}", accept=0.9, showup=0.9) for i in range(20)]
    plan = plan_wave(pool, need_count=3, safety_margin=1.0)
    # each candidate's prior_score ~ 0.4*0.9+0.4*0.9+0.1*recency+0.1*distance ~ high,
    # so a handful should suffice to exceed target=3
    assert len(plan.candidates) < 20
    assert plan.expected_confirmations >= 3.0


def test_plan_wave_respects_max_wave_size():
    pool = [make_candidate(f"c{i}", accept=0.05, showup=0.05) for i in range(50)]
    plan = plan_wave(pool, need_count=10, max_wave_size=5)
    assert len(plan.candidates) <= 5


def test_plan_wave_empty_pool_returns_empty_plan():
    plan = plan_wave([], need_count=3)
    assert plan.candidates == []
    assert plan.expected_confirmations == 0.0


def test_should_dispatch_next_wave_stops_when_need_met():
    assert not should_dispatch_next_wave(
        confirmed_count=3, need_count=3, calls_used=10, max_calls=40, remaining_pool_size=100
    )


def test_should_dispatch_next_wave_stops_at_call_budget():
    assert not should_dispatch_next_wave(
        confirmed_count=0, need_count=3, calls_used=40, max_calls=40, remaining_pool_size=100
    )


def test_should_dispatch_next_wave_stops_when_pool_exhausted():
    assert not should_dispatch_next_wave(
        confirmed_count=0, need_count=3, calls_used=5, max_calls=40, remaining_pool_size=0
    )


def test_should_dispatch_next_wave_continues_otherwise():
    assert should_dispatch_next_wave(
        confirmed_count=1, need_count=3, calls_used=5, max_calls=40, remaining_pool_size=10
    )
