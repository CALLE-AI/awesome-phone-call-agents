from risk_engine import DEFAULT_THRESHOLD, evaluate


def test_high_risk_payload_crosses_threshold():
    payload = {
        "incident_id": "inc_001",
        "signals": {"rfid_zone": "zone_3", "gas_ppm": 340, "temp_c": 41.2},
        "risk_score": 0.91,
    }
    result = evaluate(payload)
    assert result.crossed is True
    assert result.score == 0.91


def test_low_risk_payload_does_not_cross_threshold():
    payload = {
        "incident_id": "inc_002",
        "signals": {"temp_c": 24.8},
        "risk_score": 0.12,
    }
    result = evaluate(payload)
    assert result.crossed is False


def test_missing_risk_score_derives_from_correlated_signals():
    # Access anomaly + environmental anomaly together -> should cross.
    payload = {
        "incident_id": "inc_003",
        "signals": {"rfid_zone": "zone_5", "gas_ppm": 350},
    }
    result = evaluate(payload)
    assert result.crossed is True


def test_missing_risk_score_single_weak_signal_stays_under_threshold():
    # A lone, non-anomalous reading with no access component should not
    # cross the default threshold - this is Scenario B's contrast.
    payload = {
        "incident_id": "inc_004",
        "signals": {"temp_c": 24.0},
    }
    result = evaluate(payload)
    assert result.crossed is False


def test_score_is_clamped_to_zero_one_range():
    payload = {"incident_id": "inc_005", "signals": {}, "risk_score": 1.5}
    assert evaluate(payload).score == 1.0

    payload = {"incident_id": "inc_006", "signals": {}, "risk_score": -0.3}
    assert evaluate(payload).score == 0.0


def test_custom_threshold_overrides_default():
    payload = {"incident_id": "inc_007", "signals": {}, "risk_score": 0.5}
    assert evaluate(payload, threshold=0.4).crossed is True
    assert evaluate(payload, threshold=0.6).crossed is False


def test_default_threshold_is_a_sane_probability():
    assert 0.0 < DEFAULT_THRESHOLD <= 1.0
