from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

from calle.errors import CalleAPIError

from pawpassage.approval import create_approval
from pawpassage.calle_transport import OfficialCalleTransport
from pawpassage.ledger import CallLedger
from pawpassage.models import parse_case
from pawpassage.preview import preview_digest
from pawpassage.report import _card
from pawpassage.workflow import PawPassageWorkflow
from tests.helpers import raw_case


class ProviderDiagnosticTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="pawpassage-diagnostic-")
        self.directory = Path(self.temporary.name)
        self.case = parse_case(raw_case())
        self.checkpoint = self.case.checkpoint("AIRLINE_DESK")
        self.workflow = PawPassageWorkflow(CallLedger(self.directory / "calls.sqlite3"))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def arguments(
        self, error: Exception, *, api_key: str = "unit-test-key"
    ) -> tuple[dict, RejectedCalls]:
        calls = RejectedCalls(error)
        transport = OfficialCalleTransport(
            api_key=api_key,
            base_url="http://127.0.0.1:9",
            live=False,
            client_factory=lambda _key, _url: StubClient(calls),
        )
        preview = self.workflow.prepare(self.case, self.checkpoint)
        return {
            "case": self.case,
            "checkpoint": self.checkpoint,
            "approval": create_approval(
                preview,
                presented_digest=preview_digest(preview),
                approved_by="unit-test-operator",
                mode="fake",
            ),
            "transport": transport,
            "mode": "fake",
        }, calls

    def test_rejection_explains_route_without_secrets_and_cannot_redial_after_restart(self) -> None:
        api_key = "test-key/secret+value"
        error = CalleAPIError(
            code="call_not_ready",
            status_code=422,
            message=(
                "Malaysia / Mandarin Chinese (Putonghua) is not supported.\n"
                f"Recipient {self.checkpoint.phone_e164}; key {api_key}; "
                f"encoded-key {quote(api_key, safe='')}; phone +1 (555) 010-1999; "
                "local phone 011 2345 6789."
            ),
            details={"request": "UNTRUSTED_REQUEST_MUST_NOT_BE_SAVED", "token": api_key},
        )
        arguments, calls = self.arguments(error, api_key=api_key)
        first = self.workflow.execute(**arguments)
        restarted = PawPassageWorkflow(CallLedger(self.workflow.ledger.path))
        duplicate = restarted.execute(**arguments)

        self.assertEqual(first.ledger_state, "REJECTED_BEFORE_START")
        self.assertEqual(first.disposition, "NOT_CALLED")
        self.assertEqual(first.reason_codes, ("CREATE_CALL_NOT_READY",))
        self.assertIsNone(first.provider_call_id)
        self.assertIsNone(first.result)
        self.assertIn("Malaysia / Mandarin Chinese (Putonghua) is not supported", first.provider_diagnostic)
        self.assertEqual(duplicate.provider_diagnostic, first.provider_diagnostic)
        self.assertTrue(duplicate.duplicate_prevented)
        self.assertEqual((calls.creates, calls.waits, calls.gets), (1, 0, 0))
        with self.assertRaisesRegex(ValueError, "known ACCEPTED"):
            restarted.reconcile(**arguments)
        serialized = json.dumps(first.to_dict())
        database = self.workflow.ledger.path.read_bytes()
        for forbidden in (
            api_key,
            quote(api_key, safe=""),
            self.checkpoint.phone_e164,
            "+1 (555) 010-1999",
            "011 2345 6789",
            "UNTRUSTED_REQUEST_MUST_NOT_BE_SAVED",
        ):
            self.assertNotIn(forbidden, serialized)
            self.assertNotIn(forbidden.encode(), database)

    def test_long_message_is_redacted_before_truncation_and_html_is_escaped(self) -> None:
        error = CalleAPIError(
            code="unsupported_region",
            status_code=422,
            message=(
                "<script>bad()</script> Route unavailable. "
                + "x" * 750 + "unit-test-key" + "y" * 1000
            ),
        )
        arguments, _calls = self.arguments(error)
        report = self.workflow.execute(**arguments)
        self.assertLessEqual(len(report.provider_diagnostic), 800)
        self.assertTrue(report.provider_diagnostic.endswith(" [truncated]"))
        self.assertNotIn("unit-test-key", report.provider_diagnostic)
        self.assertNotIn("unit-", report.provider_diagnostic)
        card = _card(report.to_dict())
        self.assertIn("&lt;script&gt;", card)
        self.assertNotIn("<script>", card)

    def test_oversize_message_is_omitted_without_exposing_a_secret_prefix(self) -> None:
        error = CalleAPIError(
            code="call_not_ready",
            status_code=422,
            message="x" * 8189 + "unit-test-key",
        )
        arguments, _calls = self.arguments(error)
        diagnostic = self.workflow.execute(**arguments).provider_diagnostic
        self.assertIn("exceeded the size limit", diagnostic)
        self.assertNotIn("unit", diagnostic)

    def test_ambiguous_error_remains_unknown_and_does_not_capture_error_body(self) -> None:
        error = CalleAPIError(
            code="provider_unavailable", status_code=503, message="private raw response"
        )
        arguments, calls = self.arguments(error)
        first = self.workflow.execute(**arguments)
        duplicate = self.workflow.execute(**arguments)
        self.assertEqual(first.ledger_state, "SUBMISSION_UNKNOWN")
        self.assertIsNone(first.provider_diagnostic)
        self.assertTrue(duplicate.duplicate_prevented)
        self.assertEqual((calls.creates, calls.waits, calls.gets), (1, 0, 0))

    def test_existing_ledger_migration_preserves_rejected_intent_and_is_repeatable(self) -> None:
        old_path = self.directory / "old.sqlite3"
        with closing(sqlite3.connect(old_path)) as connection, connection:
            connection.executescript("""
                CREATE TABLE call_intents (
                    intent_key TEXT PRIMARY KEY, case_id TEXT NOT NULL,
                    checkpoint_id TEXT NOT NULL, preview_digest TEXT NOT NULL,
                    recipient_masked TEXT NOT NULL, state TEXT NOT NULL,
                    provider_call_id TEXT, disposition TEXT,
                    reason_codes_json TEXT NOT NULL DEFAULT '[]', result_json TEXT,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                INSERT INTO call_intents VALUES (
                    'old-intent', 'old-case', 'desk', 'digest', '+1******1001',
                    'REJECTED_BEFORE_START', NULL, 'NOT_CALLED',
                    '["CREATE_CALL_NOT_READY"]', NULL, '2026-09-13', '2026-09-13'
                );
            """)
        first = CallLedger(old_path).get("old-intent")
        second = CallLedger(old_path).get("old-intent")
        self.assertEqual(first, second)
        self.assertEqual(second.state, "REJECTED_BEFORE_START")
        self.assertEqual(second.reason_codes, ("CREATE_CALL_NOT_READY",))
        self.assertIsNone(second.provider_diagnostic)
        duplicate, created = CallLedger(old_path).reserve(
            intent_key="old-intent", case_id="old-case", checkpoint_id="desk",
            preview_digest="digest", recipient_masked="+1******1001",
        )
        self.assertFalse(created)
        self.assertEqual(duplicate, second)


class RejectedCalls:
    def __init__(self, error: Exception) -> None:
        self.error = error
        self.creates = self.waits = self.gets = 0

    def create(self, **_kwargs: object) -> dict:
        self.creates += 1
        raise self.error

    def wait_for_result(self, *_args: object, **_kwargs: object) -> dict:
        self.waits += 1
        raise AssertionError("A rejected call must not be polled")

    def get(self, *_args: object, **_kwargs: object) -> dict:
        self.gets += 1
        raise AssertionError("A rejected call must not be reconciled")


class StubClient:
    def __init__(self, calls: RejectedCalls) -> None:
        self.calls = calls

    def close(self) -> None:
        pass
