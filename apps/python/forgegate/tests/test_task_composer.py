from task_composer import compose_task


def test_composes_zone_and_gas_and_temp_into_one_task_string():
    incident = {
        "signals": {"rfid_zone": "zone_3", "gas_ppm": 340, "temp_c": 41.2},
        "proposed_action": "lock zone_3 and cut power to machine_4",
        "timestamp": "14:02 UTC",
    }
    task = compose_task(incident, risk_score=0.91)

    assert "RFID access to zone_3 at 14:02 UTC" in task
    assert "a gas reading of 340ppm" in task
    assert "risk score 91%" in task
    assert "lock zone_3 and cut power to machine_4" in task
    assert "approve, hold, or escalate" in task


def test_falls_back_to_generic_summary_when_no_recognized_signals():
    incident = {"signals": {"unknown_sensor": 7}, "proposed_action": "hold"}
    task = compose_task(incident, risk_score=0.5)
    assert "an anomalous sensor pattern" in task
    assert "risk score 50%" in task
