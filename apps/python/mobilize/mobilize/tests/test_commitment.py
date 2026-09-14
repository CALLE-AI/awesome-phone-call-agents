from hypothesis import given, strategies as st

from mobilize.core.commitment import calibrated_commitment, score_commitment_text


def test_firm_language_scores_higher_than_hedged():
    firm = score_commitment_text("I'm leaving right now, be there in 10 minutes.")
    hedged = score_commitment_text("Yeah, I'll try to make it, maybe.")
    assert firm > hedged


def test_neutral_text_is_neutral():
    assert score_commitment_text("Okay.") == 0.5


def test_calibrated_commitment_blends_language_and_prior():
    high_prior_hedged = calibrated_commitment(
        evidence="I'll try to make it, maybe.",
        candidate_prior_showup_rate=0.9,
    )
    low_prior_hedged = calibrated_commitment(
        evidence="I'll try to make it, maybe.",
        candidate_prior_showup_rate=0.1,
    )
    assert high_prior_hedged > low_prior_hedged


def test_language_weight_zero_ignores_text():
    score = calibrated_commitment(
        evidence="Absolutely, on my way right now!",
        candidate_prior_showup_rate=0.3,
        language_weight=0.0,
    )
    assert abs(score - 0.3) < 1e-9


@given(prior=st.floats(min_value=0.0, max_value=1.0), weight=st.floats(min_value=0.0, max_value=1.0))
def test_calibrated_commitment_always_in_bounds(prior, weight):
    score = calibrated_commitment(evidence="Maybe, we'll see, I think.", candidate_prior_showup_rate=prior, language_weight=weight)
    assert 0.0 <= score <= 1.0
