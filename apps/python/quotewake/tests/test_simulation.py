"""Tests for deterministic CALL-E simulation and atomic Salesforce write payloads."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
import json
from unittest import TestCase
from unittest.mock import Mock, patch

from quotewake_salesforce.calle import CallSimulationError, simulate_call
from quotewake_salesforce.domain.call_planning import build_call_plan_request
from quotewake_salesforce.domain.models import (
    CallOutcomeKind,
    ContactTarget,
    QuoteCandidate,
    SelectionDecision,
    SelectionReason,
    SelectionResult,
)
from quotewake_salesforce.domain.policy import (
    CallingHoursPolicy,
    CooldownPolicy,
    FollowUpPolicies,
    RetryPolicy,
    calculate_next_follow_up,
)
from quotewake_salesforce.salesforce.client import (
    CompositeWriteResult,
    OrgInfo,
    SalesforceClient,
)
from quotewake_salesforce.cli import salesforce_simulation_main


def _request():
    quote = QuoteCandidate(
        quote_id="0Q0000000000001",
        quote_name="QuoteWake Demo - Kitchen",
        quote_status="Presented",
        amount=Decimal("100"),
        currency_code="EUR",
        expiration_date=None,
        last_modified_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        opportunity_id="006000000000001",
        opportunity_name="Demo opportunity",
        account_name="Demo account",
        opportunity_is_closed=False,
        enabled=True,
        follow_up_status=None,
        next_follow_up_at=None,
        attempt_count=0,
        last_follow_up_at=None,
        last_follow_up_result=None,
    )
    selection = SelectionResult(
        SelectionDecision.READY,
        SelectionReason.READY,
        quote,
        ContactTarget("003000000000001", "Demo Contact", "+14155550101", False),
    )
    return build_call_plan_request(selection, [], language="Spanish", region="ES"), quote, selection.contact


def _policies() -> FollowUpPolicies:
    return FollowUpPolicies(
        retry=RetryPolicy(
            max_attempts=3,
            retry_delays=(timedelta(days=2), timedelta(days=4)),
            retry_outcomes=frozenset({"call_back_later", "no_answer", "busy"}),
            technical_failure_retry_delay=timedelta(minutes=30),
            completed_outcomes=frozenset({"interested"}),
        ),
        cooldown=CooldownPolicy(False, timedelta(0)),
        calling_hours=CallingHoursPolicy(
            False, frozenset(range(7)), time(0), time(23, 59), timezone.utc
        ),
    )


class TestCallSimulator(TestCase):
    def test_all_outcomes_map_to_salesforce_result_and_status(self):
        request, quote, _ = _request()
        now = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        expected = {
            "interested": ("Interested", "Completed"),
            "not_interested": ("Not Interested", "Stopped"),
            "call_back_later": ("Call Back Later", "Retry"),
            "no_answer": ("No Answer", "Retry"),
            "busy": ("Busy", "Retry"),
            "invalid_number": ("Invalid Number", "Stopped"),
            "error": ("Error", "Retry"),
        }
        for selected, (outcome, status) in expected.items():
            with self.subTest(outcome=selected):
                next_at = datetime(2026, 8, 10, 10, tzinfo=timezone.utc) if selected == "call_back_later" else None
                result = simulate_call(
                    request,
                    selected,
                    now=now,
                    next_follow_up_at=next_at,
                )
                self.assertEqual(result.outcome, outcome)
                self.assertEqual(
                    result.outcome_kind,
                    CallOutcomeKind.TECHNICAL_FAILURE
                    if selected == "error"
                    else CallOutcomeKind.BUSINESS,
                )
                if selected == "error":
                    self.assertEqual(result.provider_status, "SIMULATED_TECHNICAL_FAILURE")
                update = calculate_next_follow_up(
                    quote, result, _policies(), occurred_at=now
                )
                self.assertEqual(update.follow_up_status, status)

    def test_result_is_deterministic_and_does_not_call_external_services(self):
        request, _, _ = _request()
        now = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        first = simulate_call(request, "interested", now=now)
        second = simulate_call(request, "interested", now=now)
        self.assertEqual(first, second)
        self.assertEqual(first.outcome, "Interested")
        self.assertEqual(first.provider_status, "SIMULATED_COMPLETED")
        self.assertTrue(first.simulated)

    def test_no_answer_is_scheduled_by_the_policy(self):
        request, _, _ = _request()
        now = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        result = simulate_call(request, "no_answer", now=now)
        self.assertIsNone(result.next_follow_up_at)
        with self.assertRaises(CallSimulationError):
            simulate_call(request, "no_answer", now=now, next_follow_up_at=now)

    def test_retry_timestamp_is_normalized_before_seed_result_and_persistence(self):
        request, _, _ = _request()
        now = datetime(2026, 8, 9, 12, 0, 0, 123456, tzinfo=timezone.utc)
        input_next = datetime(2026, 8, 10, 10, 0, 0, 123456, tzinfo=timezone.utc)
        normalized = simulate_call(
            request,
            "call_back_later",
            now=now,
            next_follow_up_at=input_next,
        )
        canonical = simulate_call(
            request,
            "call_back_later",
            now=now,
            next_follow_up_at=input_next.replace(microsecond=0),
        )
        self.assertEqual(normalized.next_follow_up_at.microsecond, 0)
        self.assertEqual(normalized.simulation_timestamp.microsecond, 0)
        self.assertEqual(normalized.simulation_id, canonical.simulation_id)
        self.assertEqual(normalized.next_follow_up_at, canonical.next_follow_up_at)

    def test_terminal_outcome_rejects_retry_date_and_non_es_region(self):
        request, _, _ = _request()
        now = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        with self.assertRaises(CallSimulationError):
            simulate_call(
                request,
                "interested",
                now=now,
                next_follow_up_at=datetime(2026, 8, 10, tzinfo=timezone.utc),
            )
        with self.assertRaises(CallSimulationError):
            simulate_call(replace(request, region="PT"), "interested", now=now)


class TestCompositeWrite(TestCase):
    @patch("quotewake_salesforce.salesforce.client.subprocess.run")
    def test_composite_body_is_all_or_none_and_writes_quote_and_task(self, run):
        request, quote, contact = _request()
        result = simulate_call(
            request,
            "call_back_later",
            now=datetime(2026, 8, 9, 12, 0, 0, 123456, tzinfo=timezone.utc),
            next_follow_up_at=datetime(2026, 8, 10, 10, 0, 0, 123456, tzinfo=timezone.utc),
        )
        run.side_effect = [
            Mock(returncode=0, stdout=json.dumps({"status": 0, "result": {
                "username": "demo@example.invalid",
                "id": "00D000000000001",
                "alias": "quotewake-dev",
                "apiVersion": "64.0",
            }}), stderr=""),
            Mock(returncode=0, stdout=json.dumps({
                "compositeResponse": [
                    {"referenceId": "quoteUpdate", "httpStatusCode": 204, "body": None},
                    {"referenceId": "taskCreate", "httpStatusCode": 201, "body": {"id": "00T000000000001"}},
                ]
            }), stderr=""),
        ]
        client = SalesforceClient(target_org="quotewake-dev")
        follow_up_update = calculate_next_follow_up(
            quote, result, _policies(), occurred_at=result.simulation_timestamp
        )
        written = client.composite_write(
            quote,
            contact,
            result,
            follow_up_update=follow_up_update,
            task_description="QuoteWake simulated call.",
        )
        self.assertEqual(written, CompositeWriteResult(quote.quote_id, "00T000000000001"))
        command = run.call_args_list[1].args[0]
        self.assertEqual(
            command[command.index("rest") + 1],
            "/services/data/v64.0/composite",
        )
        self.assertNotIn("--url", command)
        self.assertNotIn("--json", command)
        body = json.loads(command[command.index("--body") + 1])
        self.assertTrue(body["allOrNone"])
        self.assertEqual(len(body["compositeRequest"]), 2)
        quote_body = body["compositeRequest"][0]["body"]
        self.assertEqual(quote_body["Attempt_Count__c"], 1)
        self.assertEqual(quote_body["Follow_Up_Status__c"], "Retry")
        self.assertEqual(quote_body["Next_Follow_Up_At__c"], "2026-08-10T10:00:00Z")
        task_body = body["compositeRequest"][1]["body"]
        self.assertEqual(task_body["WhoId"], contact.contact_id)
        self.assertNotIn(contact.phone, task_body["Description"])


class TestSimulationCli(TestCase):
    @patch("quotewake_salesforce.cli.CallEPlanningClient")
    @patch("quotewake_salesforce.cli.QuoteRepository")
    @patch("quotewake_salesforce.cli.SalesforceClient")
    def test_simulation_writes_only_seeded_quote_and_never_constructs_calle_client(
        self, client_class, repository_class, calle_class
    ):
        _, quote, contact = _request()
        client = client_class.return_value
        client.org_info.return_value = OrgInfo("demo", "demo@example.invalid", "00D000000000001")
        repository = repository_class.return_value
        repository.validate_schema.return_value = (
            {"Status": {"picklistValues": [{"value": "Presented"}]}},
            {},
        )
        repository.load.return_value = ([quote], {quote.opportunity_id: [contact]})
        repository.load_quote_lines.return_value = {quote.quote_id: []}
        client.composite_write.return_value = CompositeWriteResult(quote.quote_id, "00T000000000001")
        exit_code = salesforce_simulation_main(
            [
                "--target-org", "demo",
                "--quote-id", quote.quote_id,
                "--simulation-outcome", "interested",
                "--call-language", "Spanish",
                "--call-region", "ES",
                "--confirm-demo-write",
            ]
        )

        self.assertEqual(exit_code, 0)
        calle_class.assert_not_called()
        repository.load.assert_called_once_with(quote_id=quote.quote_id)
        client.composite_write.assert_called_once()


if __name__ == "__main__":
    import unittest

    unittest.main()
