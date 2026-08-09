"""Tests for Salesforce selection followed by CALL-E planning-only orchestration."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from quotewake_salesforce.calle import CallEPlanningError
from quotewake_salesforce.cli import _print_selection, salesforce_dry_run_main
from quotewake_salesforce.domain.models import (
    CallPlanDecision,
    CallPlanResult,
    ContactTarget,
    QuoteCandidate,
    QuoteLine,
    SelectionDecision,
    SelectionReason,
    SelectionResult,
)
from quotewake_salesforce.salesforce.client import OrgInfo


def quote(*, enabled: bool = True) -> QuoteCandidate:
    return QuoteCandidate(
        quote_id="0Q0000000000001" if enabled else "0Q0000000000002",
        quote_name="Ready quote" if enabled else "Disabled quote",
        quote_status="Presented",
        amount=Decimal("4250"),
        currency_code="EUR",
        expiration_date=date(2026, 9, 8),
        last_modified_at=datetime(2026, 8, 7, 12, tzinfo=timezone.utc),
        opportunity_id="006000000000001" if enabled else "006000000000002",
        opportunity_name="Demo opportunity",
        account_name="Demo company",
        opportunity_is_closed=False,
        enabled=enabled,
        follow_up_status=None,
        next_follow_up_at=None,
        attempt_count=0,
        last_follow_up_at=None,
        last_follow_up_result=None,
    )


class TestPlanningCli(unittest.TestCase):
    def test_selection_console_output_labels_and_groups_fields(self) -> None:
        candidate = quote()
        contact = ContactTarget(
            "003000000000001", "Marta García", "+14155550101", False
        )
        selection = SelectionResult(
            SelectionDecision.READY,
            SelectionReason.READY,
            candidate,
            contact,
        )

        with patch("sys.stdout", new=io.StringIO()) as output:
            _print_selection(selection)

        rendered = output.getvalue()
        self.assertIn(
            f"Quote ID: {candidate.quote_id} | Total: EUR 4250", rendered
        )
        self.assertIn(f"Description: {candidate.quote_name}", rendered)
        self.assertIn("Status: READY", rendered)
        self.assertIn("Contact: Marta García | Phone: +14******101", rendered)
        self.assertIn("Attempts: 0 | Next follow-up: not set", rendered)

    @patch("quotewake_salesforce.cli.CallEPlanningClient")
    @patch("quotewake_salesforce.cli.QuoteRepository")
    @patch("quotewake_salesforce.cli.SalesforceClient")
    def test_only_ready_quotes_are_planned_and_report_is_redacted(
        self,
        salesforce_client_class: Mock,
        repository_class: Mock,
        planner_class: Mock,
    ) -> None:
        temp_dir = Path(tempfile.mkdtemp(prefix="quotewake-cli-plan-test-"))
        selection_output = temp_dir / "selection.jsonl"
        plan_output = temp_dir / "plans.jsonl"
        salesforce_client_class.return_value.org_info.return_value = OrgInfo(
            "test-org", "test@example.invalid", "00D000000000001"
        )
        ready_quote = quote()
        disabled_quote = quote(enabled=False)
        contact = ContactTarget(
            contact_id="003000000000001",
            name="Marta García",
            phone="+14155550101",
            do_not_call=False,
        )
        repository = repository_class.return_value
        repository.validate_schema.return_value = (
            {"Status": {"picklistValues": [{"value": "Presented"}]}},
            {},
        )
        repository.load.return_value = (
            [ready_quote, disabled_quote],
            {ready_quote.opportunity_id: [contact]},
        )
        repository.load_quote_lines.return_value = {
            ready_quote.quote_id: [
                QuoteLine("Electrical labor", Decimal("1"), Decimal("4250"), Decimal("4250"))
            ]
        }
        planner = planner_class.return_value
        planner.plan.return_value = CallPlanResult(
            quote_id=ready_quote.quote_id,
            decision=CallPlanDecision.PLAN_READY,
            ready_to_run=True,
            plan_id="plan-1",
            confirm_summary="Review the quote follow-up plan.",
        )

        exit_code = salesforce_dry_run_main(
            [
                "--dry-run",
                "--target-org",
                "test-org",
                "--plan-calls",
                "--call-language",
                "Spanish",
                "--call-region",
                "ES",
                "--output",
                str(selection_output),
                "--plan-output",
                str(plan_output),
            ]
        )

        self.assertEqual(exit_code, 0)
        planner.verify_ready.assert_called_once_with()
        planner.plan.assert_called_once()
        repository.load_quote_lines.assert_called_once_with([ready_quote.quote_id])
        records = [json.loads(line) for line in plan_output.read_text().splitlines()]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["decision"], "PLAN_READY")
        self.assertEqual(records[0]["phone"], "+14******101")
        self.assertNotIn("+14155550101", plan_output.read_text())
        self.assertNotIn("confirm_token", plan_output.read_text())
        self.assertNotIn("+14155550101", selection_output.read_text())
        selection_record = json.loads(selection_output.read_text().splitlines()[0])
        self.assertEqual(
            selection_record["last_modified_at"], "2026-08-07T12:00:00Z"
        )

    @patch("quotewake_salesforce.cli.CallEPlanningClient")
    @patch("quotewake_salesforce.cli.QuoteRepository")
    @patch("quotewake_salesforce.cli.SalesforceClient")
    def test_plan_error_is_recorded_without_aborting_later_quotes(
        self,
        salesforce_client_class: Mock,
        repository_class: Mock,
        planner_class: Mock,
    ) -> None:
        temp_dir = Path(tempfile.mkdtemp(prefix="quotewake-cli-plan-error-test-"))
        salesforce_client_class.return_value.org_info.return_value = OrgInfo(
            "test-org", "test@example.invalid", "00D000000000001"
        )
        first = quote()
        second = replace(
            first,
            quote_id="0Q0000000000002",
            quote_name="Second quote",
            opportunity_id="006000000000002",
        )
        first_contact = ContactTarget("003000000000001", "First", "+14155550101", False)
        second_contact = ContactTarget("003000000000002", "Second", "+14155550102", False)
        repository = repository_class.return_value
        repository.validate_schema.return_value = (
            {"Status": {"picklistValues": [{"value": "Presented"}]}},
            {},
        )
        repository.load.return_value = (
            [first, second],
            {
                first.opportunity_id: [first_contact],
                second.opportunity_id: [second_contact],
            },
        )
        repository.load_quote_lines.return_value = {}
        planner_class.return_value.plan.side_effect = [
            CallEPlanningError("temporary planning failure"),
            CallPlanResult(
                quote_id=second.quote_id,
                decision=CallPlanDecision.PLAN_READY,
                ready_to_run=True,
                plan_id="plan-2",
            ),
        ]
        plan_output = temp_dir / "plans.jsonl"

        exit_code = salesforce_dry_run_main(
            [
                "--dry-run",
                "--target-org",
                "test-org",
                "--plan-calls",
                "--call-language",
                "Spanish",
                "--call-region",
                "ES",
                "--output",
                str(temp_dir / "selection.jsonl"),
                "--plan-output",
                str(plan_output),
            ]
        )

        self.assertEqual(exit_code, 1)
        self.assertEqual(planner_class.return_value.plan.call_count, 2)
        records = [json.loads(line) for line in plan_output.read_text().splitlines()]
        self.assertEqual(
            [record["decision"] for record in records],
            ["PLAN_ERROR", "PLAN_READY"],
        )

    def test_planning_requires_explicit_language_and_region(self) -> None:
        with patch("sys.stderr"):
            exit_code = salesforce_dry_run_main(["--dry-run", "--plan-calls"])

        self.assertEqual(exit_code, 1)

    @patch("quotewake_salesforce.cli.CallEPlanningClient")
    @patch("quotewake_salesforce.cli.QuoteRepository")
    @patch("quotewake_salesforce.cli.SalesforceClient")
    def test_no_ready_quotes_do_not_contact_calle(
        self,
        salesforce_client_class: Mock,
        repository_class: Mock,
        planner_class: Mock,
    ) -> None:
        temp_dir = Path(tempfile.mkdtemp(prefix="quotewake-no-ready-test-"))
        plan_output = temp_dir / "plans.jsonl"
        salesforce_client_class.return_value.org_info.return_value = OrgInfo(
            "test-org", "test@example.invalid", "00D000000000001"
        )
        repository = repository_class.return_value
        repository.validate_schema.return_value = (
            {"Status": {"picklistValues": [{"value": "Presented"}]}},
            {},
        )
        repository.load.return_value = ([quote(enabled=False)], {})

        exit_code = salesforce_dry_run_main(
            [
                "--dry-run",
                "--plan-calls",
                "--call-language",
                "Spanish",
                "--call-region",
                "ES",
                "--output",
                str(temp_dir / "selection.jsonl"),
                "--plan-output",
                str(plan_output),
            ]
        )

        self.assertEqual(exit_code, 0)
        planner_class.assert_not_called()
        repository.load_quote_lines.assert_not_called()
        self.assertEqual(plan_output.read_text(), "")


if __name__ == "__main__":
    unittest.main()
