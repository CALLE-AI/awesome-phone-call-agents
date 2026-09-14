from __future__ import annotations

import copy
import unittest
from datetime import UTC, datetime, timedelta

from pawpassage.approval import (
    ApprovalError,
    ApprovalReceipt,
    create_approval,
    verify_approval,
)
from pawpassage.models import parse_case
from pawpassage.preview import build_preview, dispatch_idempotency_key, preview_digest
from tests.helpers import raw_case


class ApprovalAndPreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.case = parse_case(raw_case())
        self.checkpoint = self.case.checkpoint("AIRLINE_DESK")
        self.preview = build_preview(self.case, self.checkpoint)
        self.now = datetime(2026, 9, 4, 1, 0, tzinfo=UTC)

    def test_preview_masks_phone_and_contains_hard_boundaries(self) -> None:
        rendered = str(self.preview)
        self.assertNotIn(self.checkpoint.phone_e164, rendered)
        self.assertIn("I am an AI voice assistant", self.preview["task"])
        self.assertIn("may be recorded, transcribed", self.preview["task"])
        self.assertIn("Do you consent to continue?", self.preview["task"])
        self.assertIn("Proceed only after the recipient clearly says yes", self.preview["task"])
        self.assertIn("Do not book, pay, negotiate", self.preview["task"])
        self.assertTrue(self.preview["oneAttemptOnly"])
        self.assertIn("never a booking", self.preview["authorityBoundary"])

    def test_approval_requires_the_exact_digest(self) -> None:
        with self.assertRaisesRegex(ApprovalError, "does not match"):
            create_approval(
                self.preview,
                presented_digest="0" * 64,
                approved_by="operator",
                mode="fake",
                now=self.now,
            )

    def test_every_material_preview_change_invalidates_approval(self) -> None:
        receipt = create_approval(
            self.preview,
            presented_digest=preview_digest(self.preview),
            approved_by="operator",
            mode="fake",
            now=self.now,
        )
        for key, value in [
            ("task", self.preview["task"] + " changed"),
            ("region", "CA"),
            ("recipientDigest", "f" * 64),
            ("officialSourceUrl", "https://different.example.invalid/rules"),
        ]:
            changed = copy.deepcopy(self.preview)
            changed[key] = value
            with (
                self.subTest(key=key),
                self.assertRaisesRegex(ApprovalError, "different call content"),
            ):
                verify_approval(changed, receipt, required_mode="fake", now=self.now)

    def test_live_approval_is_fresh_and_mode_specific(self) -> None:
        receipt = create_approval(
            self.preview,
            presented_digest=preview_digest(self.preview),
            approved_by="operator",
            mode="live",
            now=self.now,
        )
        verify_approval(
            self.preview,
            receipt,
            required_mode="live",
            now=self.now + timedelta(minutes=14),
        )
        with self.assertRaisesRegex(ApprovalError, "stale"):
            verify_approval(
                self.preview,
                receipt,
                required_mode="live",
                now=self.now + timedelta(minutes=16),
            )
        with self.assertRaisesRegex(ApprovalError, "mode"):
            verify_approval(self.preview, receipt, required_mode="fake", now=self.now)

    def test_receipt_shape_is_closed(self) -> None:
        raw = {
            "schema_version": "1.0",
            "preview_digest": preview_digest(self.preview),
            "approved_by": "operator",
            "approved_at": "2026-09-04T01:00:00Z",
            "mode": "fake",
        }
        self.assertEqual(ApprovalReceipt.from_dict(raw).approved_by, "operator")
        raw["secret"] = "not allowed"
        with self.assertRaises(ApprovalError):
            ApprovalReceipt.from_dict(raw)

    def test_idempotency_key_binds_preview_and_approval(self) -> None:
        digest = preview_digest(self.preview)
        key = dispatch_idempotency_key(self.preview, digest)
        self.assertEqual(key, dispatch_idempotency_key(self.preview, digest))
        changed = copy.deepcopy(self.preview)
        changed["task"] += " changed"
        self.assertNotEqual(key, dispatch_idempotency_key(changed, digest))
        self.assertNotEqual(key, dispatch_idempotency_key(self.preview, "f" * 64))


if __name__ == "__main__":
    unittest.main()
