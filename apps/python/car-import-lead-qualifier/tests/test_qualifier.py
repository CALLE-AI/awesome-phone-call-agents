"""Default tests. Every call goes through the fake client in `fake_client.py`."""

from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

from fake_client import (  # noqa: E402
    FakeCalls,
    FakeClient,
    NeverTerminatingCalls,
    blocked_result,
    opt_out_result,
    qualified_result,
)
from qualifier import locales, models, routing, runner, schema, task  # noqa: E402

EXAMPLE = json.loads((APP_ROOT / "example_leads.json").read_text(encoding="utf-8"))


def batch(raw: dict | None = None) -> models.LeadBatch:
    return models.parse_batch(deepcopy(raw or EXAMPLE))


def first_lead() -> models.Lead:
    return batch().leads[0]


def inside_business_hours(lead: models.Lead) -> datetime:
    """An instant that falls inside the lead's own local calling window."""
    monday = datetime(2026, 8, 3, tzinfo=timezone.utc)
    local = locales.next_business_start(lead.timezone, lead.business_hours, monday)
    return local.astimezone(timezone.utc)


def outside_business_hours(lead: models.Lead) -> datetime:
    start, end = lead.business_hours
    return inside_business_hours(lead) + timedelta(hours=end - start + 1)


def no_sleep(_seconds: float) -> None:
    return None


# --- models -----------------------------------------------------------------


def test_the_dialled_prefix_supplies_locale_timezone_and_business_hours():
    lead = first_lead()
    assert lead.phone.startswith("+258")
    assert lead.market.country == "Mozambique"
    assert lead.locale == "pt-MZ"
    assert lead.timezone == "Africa/Maputo"
    assert lead.business_hours == (8, 18)
    assert lead.business_hours_label.startswith("08:00-18:00")


def test_every_example_market_resolves_from_its_own_number():
    resolved = {lead.lead_id: lead.locale for lead in batch().leads}
    assert resolved == {
        "lead-mz-0001": "pt-MZ",
        "lead-test-0005": "en-US",
    }


def test_a_contradictory_country_field_cannot_change_the_market():
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["country"] = "US"
    raw["leads"][0]["market"] = "Test line"
    lead = models.parse_batch(raw).leads[0]
    assert lead.market.country == "Mozambique"
    assert lead.locale == "pt-MZ"


def test_explicit_timezone_overrides_the_market_default():
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["timezone"] = "Europe/Lisbon"
    lead = models.parse_batch(raw).leads[0]
    assert lead.market.region_hint == "MZ"
    assert lead.locale == "pt-MZ"
    assert lead.timezone == "Europe/Lisbon"


def test_unsupported_prefix_is_rejected_without_leaking_the_number():
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["phone"] = "+4915112345678"
    with pytest.raises(ValueError) as error:
        models.parse_batch(raw)
    assert str(error.value) == "unsupported destination for +491***"
    assert "12345678" not in str(error.value)


def test_inquiry_date_must_be_iso():
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["inquiry_date"] = "28/07/2026"
    with pytest.raises(ValueError, match="inquiry_date must use YYYY-MM-DD"):
        models.parse_batch(raw)


def test_phone_must_be_e164():
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["phone"] = "202-555-0143"
    with pytest.raises(ValueError, match="E.164"):
        models.parse_batch(raw)


def test_timezone_must_be_a_known_iana_name():
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["timezone"] = "EST"
    with pytest.raises(ValueError, match="IANA timezone"):
        models.parse_batch(raw)

    raw["leads"][0]["timezone"] = "Mars/Olympus"
    with pytest.raises(ValueError, match="not a known IANA timezone"):
        models.parse_batch(raw)


def test_lead_without_recorded_inquiry_is_rejected():
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["submitted_import_inquiry"] = False
    with pytest.raises(ValueError, match="submitted_import_inquiry must be true"):
        models.parse_batch(raw)


def test_duplicate_lead_ids_and_phones_are_rejected():
    raw = deepcopy(EXAMPLE)
    raw["leads"][1]["lead_id"] = raw["leads"][0]["lead_id"]
    with pytest.raises(ValueError, match="duplicate lead_id"):
        models.parse_batch(raw)

    raw = deepcopy(EXAMPLE)
    raw["leads"][1]["phone"] = raw["leads"][0]["phone"]
    with pytest.raises(ValueError, match="duplicate phone number"):
        models.parse_batch(raw)


def test_mask_phone_keeps_only_the_edges():
    masked = models.mask_phone("+258800000001")
    assert masked == "+25*******001"
    assert "800000001" not in masked


# --- locales ----------------------------------------------------------------


def test_longest_prefix_wins_over_a_shorter_one():
    assert locales.resolve_market("+12025550143").region_hint == "US"
    assert locales.resolve_market("+258800000001").region_hint == "MZ"
    assert locales.supported_prefixes()[-1] == "+1"


def test_business_hours_reject_weekends_and_late_evenings():
    lead = first_lead()
    saturday_noon = datetime(2026, 8, 8, 10, 0, tzinfo=timezone.utc)
    assert not locales.within_business_hours(
        lead.timezone, lead.business_hours, saturday_noon
    )
    assert locales.within_business_hours(
        lead.timezone, lead.business_hours, inside_business_hours(lead)
    )
    assert not locales.within_business_hours(
        lead.timezone, lead.business_hours, outside_business_hours(lead)
    )


def test_next_business_start_is_inside_the_window():
    lead = first_lead()
    upcoming = locales.next_business_start(
        lead.timezone, lead.business_hours, outside_business_hours(lead)
    )
    assert lead.market.contains(upcoming)
    assert upcoming.tzinfo is not None


# --- task and schema --------------------------------------------------------


def test_task_discloses_ai_identity_and_states_the_limits():
    lead = first_lead()
    text = task.build_task(lead)
    assert "AI calling assistant" in text
    assert lead.dealer_display_name in text
    assert lead.vehicle_interest in text
    assert "Do not quote a price" in text
    assert "Never claim to be a human" in text
    assert lead.phone not in text


def test_task_speaks_the_options_the_schema_accepts():
    text = task.build_task(first_lead())
    for vehicle_type in schema.enum_of("vehicle_type"):
        if vehicle_type != "unknown":
            assert vehicle_type in text
    assert "unknown" not in schema.spoken_options("vehicle_type")


def test_schema_closes_every_enum_and_the_object():
    result_schema = schema.build_result_schema()
    properties = result_schema["properties"]

    assert result_schema["additionalProperties"] is False
    for name, definition in properties.items():
        assert definition["type"] == "string"
        if name != "evidence":
            assert "unknown" in definition["enum"], name
        assert definition["description"]

    assert set(result_schema["required"]) == {
        "right_person",
        "continued_after_ai_disclosure",
        "buying_intent",
        "payment_blocker",
        "evidence",
    }
    assert set(result_schema["required"]) <= set(properties)


def test_schema_is_a_fresh_object_each_call():
    first = schema.build_result_schema()
    first["properties"]["buying_intent"]["enum"].append("mutated")
    assert "mutated" not in schema.enum_of("buying_intent")


def test_fake_results_only_use_fields_the_schema_declares():
    allowed = set(schema.build_result_schema()["properties"])
    for result in (qualified_result(), blocked_result(), opt_out_result()):
        assert set(result) <= allowed
        for field, value in result.items():
            if field != "evidence":
                assert value in schema.enum_of(field), (field, value)


# --- preview ----------------------------------------------------------------


def test_preview_masks_every_phone_and_creates_no_call():
    loaded = batch()
    plan = runner.preview(loaded, loaded.leads, inside_business_hours(loaded.leads[0]))
    rendered = json.dumps(plan)

    assert plan["creates_phone_call"] is False
    assert plan["lead_count"] == 2
    for lead in loaded.leads:
        assert lead.phone not in rendered
        assert lead.masked_phone in rendered
    assert (
        plan["leads"][0]["idempotency_key"]
        == "carimport-import-demo-2026-08-lead-mz-0001-4e87bcc1"
    )
    assert plan["leads"][0]["market"] == "Mozambique / pt-MZ / Africa/Maputo"


def test_preview_reports_the_local_calling_window():
    loaded = batch()
    lead = loaded.leads[0]
    plan = runner.preview(loaded, (lead,), outside_business_hours(lead))
    schedule = plan["leads"][0]["schedule"]
    assert schedule["within_business_hours"] is False
    assert schedule["next_local_window"] is not None


# --- execute ----------------------------------------------------------------


def test_execute_creates_one_call_per_lead_and_polls_until_terminal():
    loaded = batch()
    lead = loaded.leads[0]
    client = FakeClient(FakeCalls(pending_polls=2))

    payload = runner.execute(
        loaded,
        (lead,),
        client.calls,
        now=inside_business_hours(lead),
        timeout_seconds=30,
        interval_seconds=0.01,
        sleep=no_sleep,
    )

    assert len(client.calls.created) == 1
    assert len(client.calls.polls) == 3  # queued, in_progress, completed
    assert payload["calls_created"] == 1
    result = payload["results"][0]
    assert result["outcome"] == "called"
    assert result["provider_status"] == "completed"
    assert result["decision"]["route"] == "book_specialist_callback"
    assert result["decision"]["priority"] == "high"
    assert lead.phone not in json.dumps(payload)


def test_execute_sends_the_real_number_only_to_the_provider():
    loaded = batch()
    lead = loaded.leads[0]
    client = FakeClient(FakeCalls())
    runner.execute(
        loaded,
        (lead,),
        client.calls,
        now=inside_business_hours(lead),
        timeout_seconds=30,
        interval_seconds=0.01,
        sleep=no_sleep,
    )
    sent = client.calls.created[0]
    assert sent["recipients"] == [{"phones": [lead.phone], "locale": lead.locale}]
    assert sent["idempotency_key"] == runner.idempotency_key(lead)
    assert "phone" not in json.dumps(sent["metadata"])


def test_correcting_a_mistyped_number_changes_the_idempotency_key():
    """A corrected number must not dedupe against the call to the wrong one."""
    original = first_lead()
    raw = deepcopy(EXAMPLE)
    raw["leads"][0]["phone"] = "+258800000009"
    corrected = batch(raw).leads[0]

    assert corrected.lead_id == original.lead_id
    assert corrected.campaign_id == original.campaign_id
    assert runner.idempotency_key(corrected) != runner.idempotency_key(original)
    # The key travels in headers and logs, so it carries a digest, not a number.
    assert original.phone not in runner.idempotency_key(original)


def test_rerun_with_a_state_file_places_no_second_call(tmp_path):
    loaded = batch()
    lead = loaded.leads[0]
    state_path = tmp_path / "state.json"
    calls = FakeCalls()
    moment = inside_business_hours(lead)

    for _ in range(2):
        payload = runner.execute(
            loaded,
            (lead,),
            calls,
            now=moment,
            timeout_seconds=30,
            interval_seconds=0.01,
            state_path=state_path,
            sleep=no_sleep,
        )

    assert len(calls.created) == 1
    assert payload["results"][0]["outcome"] == "skipped"
    assert payload["calls_created"] == 0
    assert json.loads(state_path.read_text(encoding="utf-8"))["calls"][lead.lead_id]


def test_provider_confidence_object_is_read_as_a_score():
    # CALL-E returns {"score": float, "label": str}; a float is also accepted.
    assert runner.confidence_score({"score": 0.66, "label": "medium"}) == 0.66
    assert runner.confidence_score(0.42) == 0.42
    assert runner.confidence_score({"label": "medium"}) is None
    assert runner.confidence_score(True) is None
    assert runner.confidence_score(None) is None


def test_low_confidence_object_still_blocks_a_booking():
    loaded = batch()
    lead = loaded.leads[0]
    calls = FakeCalls(completion_confidence={"score": 0.66, "label": "medium"})

    payload = runner.execute(
        loaded,
        (lead,),
        calls,
        now=inside_business_hours(lead),
        timeout_seconds=30,
        interval_seconds=0.01,
        sleep=no_sleep,
    )

    result = payload["results"][0]
    assert result["completion_confidence"] == {"score": 0.66, "label": "medium"}
    assert result["decision"]["route"] == "manual_review"


def test_a_retry_later_lead_is_dialled_again_with_a_new_key(tmp_path):
    loaded = batch()
    lead = loaded.leads[0]
    state_path = tmp_path / "state.json"
    moment = inside_business_hours(lead)

    def run(calls):
        return runner.execute(
            loaded,
            (lead,),
            calls,
            now=moment,
            timeout_seconds=30,
            interval_seconds=0.01,
            state_path=state_path,
            sleep=no_sleep,
        )

    failed = FakeCalls(status="failed", task_completed=False)
    first = run(failed)
    assert first["results"][0]["decision"]["route"] == "retry_later"
    assert first["results"][0]["attempt"] == 1

    recovered = FakeCalls()
    second = run(recovered)
    result = second["results"][0]
    assert result["outcome"] == "called"
    assert result["attempt"] == 2
    # A fresh key, or the provider would replay the failed call instead of dialling.
    assert result["idempotency_key"].endswith("-a2")
    assert result["idempotency_key"] != first["results"][0]["idempotency_key"]
    assert recovered.created[0]["idempotency_key"] == result["idempotency_key"]
    assert result["decision"]["route"] == "book_specialist_callback"

    # Once decided, the lead is left alone again.
    third = run(FakeCalls())
    assert third["results"][0]["outcome"] == "skipped"


def test_the_retry_budget_stops_endless_redialling(tmp_path):
    loaded = batch()
    lead = loaded.leads[0]
    state_path = tmp_path / "state.json"
    moment = inside_business_hours(lead)
    outcomes = []

    for _ in range(4):
        payload = runner.execute(
            loaded,
            (lead,),
            FakeCalls(status="no_answer", task_completed=False),
            now=moment,
            timeout_seconds=30,
            interval_seconds=0.01,
            state_path=state_path,
            max_attempts=2,
            sleep=no_sleep,
        )
        outcomes.append(payload["results"][0]["outcome"])

    assert outcomes == ["called", "called", "exhausted", "exhausted"]
    assert json.loads(state_path.read_text(encoding="utf-8"))["calls"][lead.lead_id][
        "attempts"
    ] == 2


def test_execute_defers_leads_outside_their_local_business_hours():
    loaded = batch()
    lead = loaded.leads[0]
    calls = FakeCalls()

    payload = runner.execute(
        loaded,
        (lead,),
        calls,
        now=outside_business_hours(lead),
        timeout_seconds=30,
        interval_seconds=0.01,
        sleep=no_sleep,
    )

    assert calls.created == []
    result = payload["results"][0]
    assert result["outcome"] == "deferred"
    assert result["decision"]["route"] == "retry_later"
    assert result["next_local_window"]


def test_opt_out_during_the_call_suppresses_the_number():
    loaded = batch()
    lead = loaded.leads[0]
    calls = FakeCalls(structured_result=opt_out_result())

    payload = runner.execute(
        loaded,
        (lead,),
        calls,
        now=inside_business_hours(lead),
        timeout_seconds=30,
        interval_seconds=0.01,
        sleep=no_sleep,
    )

    decision = payload["results"][0]["decision"]
    assert decision["route"] == "suppress_number"
    assert decision["suppress_number"] is True
    assert decision["follow_up_allowed"] is False


def test_phone_numbers_are_stripped_from_returned_evidence():
    loaded = batch()
    lead = loaded.leads[0]
    calls = FakeCalls(echo_phone_in_summary=True)

    payload = runner.execute(
        loaded,
        (lead,),
        calls,
        now=inside_business_hours(lead),
        timeout_seconds=30,
        interval_seconds=0.01,
        sleep=no_sleep,
    )

    evidence = payload["results"][0]["structured_result"]["evidence"]
    assert lead.phone not in evidence
    assert "[phone-redacted]" in evidence


def test_a_declined_call_ends_the_poll_instead_of_hanging_the_batch():
    """CALL-E reports a decline for a route that never established media."""
    loaded = batch()
    lead, next_lead = loaded.leads[0], loaded.leads[1]
    calls = FakeCalls(status="declined", task_completed=False)
    # Maputo 08:00-18:00 is 06:00-16:00 UTC; the New York test line's 09:00-20:00
    # is 13:00-24:00 UTC. Eight hours past the Maputo opening lands at 14:00 UTC,
    # inside both, so the second lead is callable rather than deferred.
    moment = inside_business_hours(lead) + timedelta(hours=8)

    payload = runner.execute(
        loaded,
        (lead, next_lead),
        calls,
        now=moment,
        timeout_seconds=30,
        interval_seconds=0.01,
        sleep=no_sleep,
    )

    assert payload["results"][0]["decision"]["route"] == "retry_later"
    # The second lead is only reached if the first one did not time out.
    assert payload["calls_created"] == 2


def test_polling_stops_at_the_timeout():
    calls = NeverTerminatingCalls()
    calls.create(idempotency_key="k", recipients=[])
    with pytest.raises(TimeoutError, match="terminal status"):
        runner.poll_for_result(
            calls,
            "call_fake_001",
            timeout_seconds=0,
            interval_seconds=0.01,
            sleep=no_sleep,
        )


# --- routing ----------------------------------------------------------------


def test_unanswered_call_is_retried_and_never_routed_commercially():
    decision = routing.route_outcome(
        first_lead(), None, provider_status="no_answer"
    )
    assert decision.route == "retry_later"
    assert decision.suppress_number is False


def test_a_decline_is_retried_within_the_attempt_budget():
    """A decline can mean a refusal or a failed route, so it is not final."""
    for status in ("declined", "rejected"):
        decision = routing.route_outcome(
            first_lead(), None, provider_status=status
        )
        assert decision.route == "retry_later", status
        assert decision.suppress_number is False


def test_low_confidence_goes_to_manual_review():
    decision = routing.route_outcome(
        first_lead(),
        qualified_result(),
        provider_status="completed",
        task_completed=True,
        completion_confidence=0.4,
    )
    assert decision.route == "manual_review"


def test_wrong_person_suppresses_the_number_even_on_a_partial_call():
    structured = qualified_result() | {"right_person": "no"}
    decision = routing.route_outcome(
        first_lead(),
        structured,
        provider_status="completed",
        task_completed=False,
    )
    assert decision.route == "suppress_number"


def decide(structured: dict, **overrides) -> routing.Decision:
    kwargs = {
        "provider_status": "completed",
        "task_completed": True,
        "completion_confidence": 0.95,
    } | overrides
    return routing.route_outcome(first_lead(), structured, **kwargs)


def test_a_payment_blocker_beats_a_ready_buyer_to_its_own_queue():
    decision = decide(blocked_result())
    assert decision.route == "payment_support"
    assert decision.priority == "high"
    assert decision.payment_blocker == "forex_unavailable"
    assert decision.follow_up_allowed is True


def test_every_declared_blocker_routes_to_payment_support():
    for blocker in routing.KNOWN_BLOCKERS:
        decision = decide(qualified_result() | {"payment_blocker": blocker})
        assert decision.route == "payment_support", blocker
    assert "none" not in routing.KNOWN_BLOCKERS
    assert "unknown" not in routing.KNOWN_BLOCKERS


def test_comparing_lead_nurtures_unless_money_is_stuck():
    nurture = decide(qualified_result() | {"buying_intent": "comparing"})
    assert nurture.route == "nurture_sequence"
    assert nurture.priority == "medium"

    stuck = decide(
        qualified_result()
        | {"buying_intent": "comparing", "payment_blocker": "transfer_limit"}
    )
    assert stuck.route == "payment_support"


def test_browsing_lead_is_low_priority_nurture():
    decision = decide(qualified_result() | {"buying_intent": "just_browsing"})
    assert decision.route == "nurture_sequence"
    assert decision.priority == "low"


def test_not_interested_closes_the_lead():
    decision = decide(qualified_result() | {"buying_intent": "not_interested"})
    assert decision.route == "close_lead"
    assert decision.follow_up_allowed is False


def test_refused_callback_closes_the_lead_without_suppressing_it():
    decision = decide(qualified_result() | {"wants_human_callback": "no"})
    assert decision.route == "close_lead"
    assert decision.follow_up_allowed is False
    assert decision.suppress_number is False


def test_unclear_callback_consent_never_books_a_human():
    decision = decide(qualified_result() | {"wants_human_callback": "unknown"})
    assert decision.route == "manual_review"
    assert decision.follow_up_allowed is False


def test_ready_buyer_with_unclear_blocker_books_at_lower_priority():
    decision = decide(qualified_result() | {"payment_blocker": "unknown"})
    assert decision.route == "book_specialist_callback"
    assert decision.priority == "medium"


def test_absent_optional_fields_are_treated_as_unknown():
    decision = decide(
        {
            "right_person": "yes",
            "continued_after_ai_disclosure": "yes",
            "buying_intent": "unknown",
            "payment_blocker": "none",
            "evidence": "The line dropped before the questions.",
        }
    )
    assert decision.route == "manual_review"


# --- command line -----------------------------------------------------------


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "qualifier.runner", *args],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=30,
    )


def test_cli_preview_is_the_default_and_needs_no_credentials():
    result = run_cli("--leads", "example_leads.json")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["mode"] == "preview"
    assert payload["creates_phone_call"] is False
    for lead in EXAMPLE["leads"]:
        assert lead["phone"] not in result.stdout


def test_cli_execute_requires_the_consent_flag():
    result = run_cli("--leads", "example_leads.json", "--execute")
    assert result.returncode == 2
    assert "--confirm-lead-consent" in result.stderr


def test_cli_can_select_a_single_lead_and_rejects_unknown_ids():
    result = run_cli("--leads", "example_leads.json", "--lead-id", "lead-test-0005")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["lead_count"] == 1
    assert payload["leads"][0]["lead_id"] == "lead-test-0005"
    assert payload["leads"][0]["market"] == "Test line / en-US / America/New_York"

    missing = run_cli("--leads", "example_leads.json", "--lead-id", "lead-none")
    assert missing.returncode == 2
    assert "is not present" in missing.stderr


def test_cli_output_file_is_private_and_never_overwritten(tmp_path):
    destination = tmp_path / "plan.json"
    first = run_cli("--leads", "example_leads.json", "--output", str(destination))
    assert first.returncode == 0, first.stderr
    assert destination.stat().st_mode & 0o777 == 0o600

    second = run_cli("--leads", "example_leads.json", "--output", str(destination))
    assert second.returncode == 2
    assert "exists" in second.stderr.lower()
