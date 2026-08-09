"""Tests for QuoteWake initial scaffold and core logic."""

from __future__ import annotations

import io
import json
import unittest
from unittest.mock import patch

from quotewake_salesforce.cli import (
    Invoice,
    NumberValidationError,
    build_call_context,
    main,
    mask_phone_number,
    run_quotewake,
    sample_invoices,
    should_follow_up,
    validate_e164_phone,
)


class TestQuoteWake(unittest.TestCase):
    """Unit tests for QuoteWake functions and models."""

    def test_validate_e164_phone_valid(self) -> None:
        self.assertEqual(validate_e164_phone("+14155550131"), "+14155550131")
        self.assertEqual(validate_e164_phone("+14155550178"), "+14155550178")

    def test_validate_e164_phone_invalid(self) -> None:
        invalid_phones = ["", "15550100011", "+1", "invalid", "+141555501312233445566"]
        for invalid in invalid_phones:
            with self.subTest(invalid=invalid):
                with self.assertRaises(NumberValidationError):
                    validate_e164_phone(invalid)

    def test_mask_phone_number(self) -> None:
        phone = "+14155550131"
        masked = mask_phone_number(phone)
        self.assertEqual(masked, "+15*******11")
        self.assertNotIn(phone, masked)
        self.assertTrue(masked.startswith("+15"))
        self.assertTrue(masked.endswith("11"))

    def test_should_follow_up(self) -> None:
        inv_overdue = Invoice("1", "Acme", "+14155550131", 100.0, "2026-08-01", "overdue")
        inv_pending = Invoice("2", "Beta", "+14155550142", 50.0, "2026-08-10", "pending")
        inv_paid = Invoice("3", "Gamma", "+14155550153", 0.0, "2026-07-01", "paid")
        inv_cancelled = Invoice("4", "Delta", "+14155550164", 200.0, "2026-08-01", "cancelled")

        self.assertTrue(should_follow_up(inv_overdue))
        self.assertTrue(should_follow_up(inv_pending))
        self.assertFalse(should_follow_up(inv_paid))
        self.assertFalse(should_follow_up(inv_cancelled))

    def test_build_call_context(self) -> None:
        inv = Invoice("INV-100", "Acme Corp", "+14155550131", 500.0, "2026-08-01", "overdue")
        ctx = build_call_context(inv)

        self.assertEqual(ctx["invoice_id"], "INV-100")
        self.assertEqual(ctx["customer_name"], "Acme Corp")
        self.assertEqual(ctx["masked_phone"], "+15*******11")
        self.assertNotIn("+14155550131", str(ctx))
        self.assertIn("Invoice #INV-100", ctx["task_prompt"])

    def test_run_quotewake_dry_run(self) -> None:
        invoices = sample_invoices()
        summary = run_quotewake(invoices, dry_run=True)

        self.assertEqual(summary["mode"], "dry_run / simulated")
        self.assertEqual(summary["total_invoices"], 3)
        self.assertEqual(summary["follow_ups_required"], 2)

        results = summary["results"]
        self.assertIsInstance(results, list)
        self.assertEqual(len(results), 3)

        paid_item = [r for r in results if isinstance(r, dict) and r.get("invoice_id") == "INV-1003"][0]
        self.assertFalse(paid_item["should_follow_up"])
        self.assertEqual(paid_item["action"], "skipped")

    def test_no_full_phone_number_in_output(self) -> None:
        invoices = sample_invoices()
        summary = run_quotewake(invoices, dry_run=True)
        json_output = json.dumps(summary)

        for inv in invoices:
            self.assertNotIn(inv.phone_number, json_output)
            self.assertIn(mask_phone_number(inv.phone_number), json_output)

    def test_main_cli(self) -> None:
        with patch("sys.stdout", new=io.StringIO()) as fake_out:
            exit_code = main(["--json"])
            self.assertEqual(exit_code, 0)
            captured = fake_out.getvalue()
            data = json.loads(captured)
            self.assertEqual(data["mode"], "dry_run / simulated")
            self.assertEqual(data["total_invoices"], 3)

    def test_main_help_lists_all_workflow_modes_and_options(self) -> None:
        with patch("sys.stdout", new=io.StringIO()) as fake_out:
            exit_code = main(["--help"])

        self.assertEqual(exit_code, 0)
        captured = fake_out.getvalue()
        for option in (
            "--plan-calls",
            "--simulate-call",
            "--quote-id",
            "--simulation-outcome",
            "--next-follow-up-at",
            "--confirm-demo-write",
            "--config",
        ):
            with self.subTest(option=option):
                self.assertIn(option, captured)


if __name__ == "__main__":
    unittest.main()
