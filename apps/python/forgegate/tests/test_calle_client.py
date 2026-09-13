import calle_client


def test_dry_run_is_the_default():
    # Tests must never place a real call. This asserts the safe default
    # holds unless CALLE_DRY_RUN=false is explicitly set in the environment.
    assert calle_client.DRY_RUN is True


def test_idempotency_key_is_deterministic_per_incident():
    key_a = calle_client.idempotency_key("inc_001")
    key_b = calle_client.idempotency_key("inc_001")
    key_c = calle_client.idempotency_key("inc_002")
    assert key_a == key_b
    assert key_a != key_c


def test_place_call_in_dry_run_needs_no_credentials_and_returns_mocked_hold():
    result = calle_client.place_call("call the lead", "inc_001")
    assert result.call_id.startswith("dryrun_")
    assert result.task_completed is True
    assert result.disposition == "HOLD"
    assert result.dry_run is True


def test_place_call_respects_mock_disposition_override():
    result = calle_client.place_call("call the lead", "inc_001", mock_disposition="APPROVE")
    assert result.disposition == "APPROVE"


def test_resolve_action_state_is_fail_closed():
    assert calle_client.resolve_action_state("APPROVE") == "EXECUTED"
    for disposition in ("HOLD", "ESCALATE", "NO_ANSWER", "UNCLEAR", "DENY", "DISPATCH_FAILED"):
        assert calle_client.resolve_action_state(disposition) == "HELD"


def test_disposition_from_result_treats_any_non_completed_status_as_no_answer():
    for status in ("FAILED", "DECLINED", "BUSY", "VOICEMAIL", "CANCELED", "EXPIRED"):
        assert calle_client._disposition_from_result(status, True, {"disposition": "APPROVE"}) == "NO_ANSWER"


def test_disposition_from_result_reads_structured_result_when_reached():
    assert calle_client._disposition_from_result("COMPLETED", True, {"disposition": "hold"}) == "HOLD"


def test_disposition_from_result_falls_back_to_unclear():
    assert calle_client._disposition_from_result("COMPLETED", True, {}) == "UNCLEAR"
    assert calle_client._disposition_from_result("COMPLETED", False, {"disposition": "APPROVE"}) == "UNCLEAR"
    assert calle_client._disposition_from_result("COMPLETED", True, {"disposition": "MAYBE"}) == "UNCLEAR"
