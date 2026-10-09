from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from pawpassage.ledger import CallLedger, LedgerError


class LedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="pawpassage-ledger-test-")
        self.ledger = CallLedger(Path(self.temporary.name) / "ledger.sqlite3")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_reservation_is_durable_and_duplicate_safe(self) -> None:
        arguments = {
            "intent_key": "intent-1",
            "case_id": "CASE-1",
            "checkpoint_id": "AIRLINE",
            "preview_digest": "a" * 64,
            "recipient_masked": "+1******1001",
        }
        first, created = self.ledger.reserve(**arguments)
        second, duplicate_created = self.ledger.reserve(**arguments)
        self.assertTrue(created)
        self.assertFalse(duplicate_created)
        self.assertEqual(first.intent_key, second.intent_key)
        self.assertEqual(second.state, "RESERVED")

    def test_happy_transition_sequence(self) -> None:
        self._reserve()
        accepted = self.ledger.mark_accepted("intent-1", "call-1")
        self.assertEqual(accepted.state, "ACCEPTED")
        terminal = self.ledger.mark_terminal(
            "intent-1",
            disposition="EVIDENCE_PACKET_READY",
            reason_codes=("ALL_PROPOSITIONS_CONFIRMED",),
            result={"schemaVersion": "1.0"},
        )
        self.assertEqual(terminal.state, "TERMINAL_VERIFIED")
        self.assertEqual(self.ledger.get("intent-1"), terminal)

    def test_illegal_transition_cannot_overwrite_history(self) -> None:
        self._reserve()
        self.ledger.mark_submission_unknown("intent-1", "CREATE_TIMEOUT")
        with self.assertRaisesRegex(LedgerError, "Refusing transition"):
            self.ledger.mark_accepted("intent-1", "call-1")
        self.assertEqual(self.ledger.get("intent-1").state, "SUBMISSION_UNKNOWN")  # type: ignore[union-attr]

    def test_ledger_never_needs_full_phone_number(self) -> None:
        self._reserve()
        payload = (Path(self.temporary.name) / "ledger.sqlite3").read_bytes()
        self.assertNotIn(b"+15550101001", payload)
        self.assertIn(b"+1******1001", payload)

    def _reserve(self) -> None:
        self.ledger.reserve(
            intent_key="intent-1",
            case_id="CASE-1",
            checkpoint_id="AIRLINE",
            preview_digest="a" * 64,
            recipient_masked="+1******1001",
        )


if __name__ == "__main__":
    unittest.main()
