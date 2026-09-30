from __future__ import annotations

import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from pawpassage.approval import ApprovalError, create_approval
from pawpassage.calle_transport import OfficialCalleTransport
from pawpassage.cli import main
from pawpassage.ledger import CallLedger
from pawpassage.models import parse_case
from pawpassage.preview import preview_digest
from pawpassage.workflow import PawPassageWorkflow
from tests.helpers import completed_result, raw_case


class RecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="pawpassage-recovery-")
        self.root = Path(self.directory.name)
        self.case = parse_case(raw_case())
        self.checkpoint = self.case.checkpoint("AIRLINE_DESK")
        self.ledger = CallLedger(self.root / "calls.sqlite3")
        self.workflow = PawPassageWorkflow(self.ledger)
        self.calls = RecoverableCalls()
        self.mode = "fake"

    def tearDown(self) -> None:
        self.directory.cleanup()

    def transport(self, *, live: bool = False) -> OfficialCalleTransport:
        return OfficialCalleTransport(
            api_key="unit-test-key",
            base_url="https://api.heycall-e.com" if live else "http://127.0.0.1:9",
            live=live,
            client_factory=lambda _key, _url: StubClient(self.calls),
        )

    def arguments(self) -> dict:
        preview = self.workflow.prepare(self.case, self.checkpoint)
        return {
            "case": self.case,
            "checkpoint": self.checkpoint,
            "approval": create_approval(
                preview,
                presented_digest=preview_digest(preview),
                approved_by="unit-test-operator",
                mode=self.mode,
            ),
            "transport": self.transport(live=self.mode == "live"),
            "mode": self.mode,
        }

    def test_wait_timeout_can_be_recovered_after_process_restart_without_redial(
        self,
    ) -> None:
        args = self.arguments()
        first = self.workflow.execute(**args)
        self.assertEqual(first.ledger_state, "ACCEPTED")
        self.assertEqual(first.provider_call_id, "known-call-1")
        self.assertIn("READ_TIMEOUTERROR", first.reason_codes)
        restarted = PawPassageWorkflow(CallLedger(self.ledger.path))
        duplicate = restarted.execute(**args)
        self.assertTrue(duplicate.duplicate_prevented)
        final = restarted.reconcile(**args)
        self.assertEqual(final.disposition, "EVIDENCE_PACKET_READY")
        self.assertEqual((self.calls.creates, self.calls.gets), (1, 1))

    def test_repeated_read_failure_and_pending_status_remain_recoverable(self) -> None:
        args = self.arguments()
        self.workflow.execute(**args)
        self.calls.read_error = ConnectionError("offline test")
        failed_read = self.workflow.reconcile(**args)
        self.assertEqual(failed_read.ledger_state, "ACCEPTED")
        self.calls.read_error = None
        self.calls.pending = True
        pending = self.workflow.reconcile(**args)
        self.assertEqual(pending.ledger_state, "ACCEPTED")
        self.assertEqual(pending.reason_codes, ("CALL_NOT_TERMINAL",))
        self.calls.pending = False
        self.assertEqual(
            self.workflow.reconcile(**args).disposition, "EVIDENCE_PACKET_READY"
        )
        self.assertEqual((self.calls.creates, self.calls.gets), (1, 3))

    def test_expired_live_receipt_allows_only_reading_existing_call(self) -> None:
        self.mode = "live"
        args = self.arguments()
        self.workflow.execute(**args)
        args["approval"] = replace(
            args["approval"],
            approved_at=(datetime.now(UTC) - timedelta(hours=1)).isoformat(),
        )
        with self.assertRaisesRegex(ApprovalError, "stale"):
            self.workflow.execute(**args)
        self.assertEqual(
            self.workflow.reconcile(**args).disposition, "EVIDENCE_PACKET_READY"
        )
        self.assertEqual(self.calls.creates, 1)

    def test_expired_receipt_does_not_bypass_content_binding(self) -> None:
        self.mode = "live"
        args = self.arguments()
        self.workflow.execute(**args)
        args["approval"] = replace(args["approval"], preview_digest="0" * 64)
        with self.assertRaisesRegex(ApprovalError, "different call content"):
            self.workflow.reconcile(**args)
        self.assertEqual(self.calls.gets, 0)

    def test_mismatched_terminal_stays_quarantined(self) -> None:
        args = self.arguments()
        self.workflow.execute(**args)
        self.calls.terminal_mismatch = True
        quarantined = self.workflow.reconcile(**args)
        self.assertEqual(quarantined.ledger_state, "NEEDS_HUMAN")
        with self.assertRaisesRegex(ValueError, "known ACCEPTED"):
            self.workflow.reconcile(**args)
        self.assertEqual((self.calls.creates, self.calls.gets), (1, 1))

    def test_mismatched_create_preserves_id_but_does_not_enable_recovery(self) -> None:
        self.calls.create_mismatch = True
        args = self.arguments()
        report = self.workflow.execute(**args)
        self.assertEqual(report.ledger_state, "SUBMISSION_UNKNOWN")
        self.assertEqual(report.provider_call_id, "known-call-1")
        with self.assertRaisesRegex(ValueError, "known ACCEPTED"):
            self.workflow.reconcile(**args)
        self.assertTrue(self.workflow.execute(**args).duplicate_prevented)
        self.assertEqual(
            (self.calls.creates, self.calls.gets, self.calls.waits), (1, 0, 0)
        )

    def test_fake_approval_cannot_use_live_transport(self) -> None:
        args = self.arguments()
        args["transport"] = self.transport(live=True)
        with self.assertRaisesRegex(ValueError, "Transport mode"):
            self.workflow.execute(**args)
        self.assertEqual(self.calls.creates, 0)

    def test_get_only_cli_works_with_live_kill_switch_off(self) -> None:
        self.mode = "live"
        args = self.arguments()
        self.workflow.execute(**args)
        case_path = self.root / "case.json"
        receipt_path = self.root / "approval.json"
        case_path.write_text(json.dumps(raw_case()), encoding="utf-8")
        receipt_path.write_text(
            json.dumps(args["approval"].to_dict()), encoding="utf-8"
        )
        with (
            patch.dict(
                os.environ,
                {
                    "CALLE_API_KEY": "unit-test-key",
                    "PAWPASSAGE_LIVE_CALLS": "DISABLED",
                    "PAWPASSAGE_ALLOWED_RECIPIENT_E164": self.checkpoint.phone_e164,
                },
            ),
            patch(
                "pawpassage.cli.OfficialCalleTransport", return_value=args["transport"]
            ),
            redirect_stdout(io.StringIO()) as output,
        ):
            status = main(
                [
                    "reconcile-live",
                    "--case",
                    str(case_path),
                    "--checkpoint",
                    "AIRLINE_DESK",
                    "--approval",
                    str(receipt_path),
                    "--ledger",
                    str(self.ledger.path),
                ]
            )
        self.assertEqual(status, 0)
        self.assertIn("EVIDENCE_PACKET_READY", output.getvalue())
        self.assertNotIn(self.checkpoint.phone_e164, output.getvalue())
        self.assertEqual((self.calls.creates, self.calls.gets), (1, 1))

    def test_test_recipient_is_not_asked_to_impersonate_service_desk(self) -> None:
        task = self.workflow.prepare(self.case, self.checkpoint)["task"]
        self.assertIn("synthetic checklist test", task)
        self.assertIn("consenting test participant", task)
        self.assertNotIn("First confirm that the person can speak for", task)


class RecoverableCalls:
    def __init__(self) -> None:
        self.creates = self.gets = self.waits = 0
        self.read_error = None
        self.pending = self.create_mismatch = self.terminal_mismatch = False
        self.request = {}

    def create(self, **kwargs: object) -> dict:
        self.creates += 1
        self.request = copy.deepcopy(kwargs)
        value = self.payload(terminal=False)
        if self.create_mismatch:
            value["task"] = "unrelated task"
        return value

    def wait_for_result(self, *_args: object, **_kwargs: object) -> dict:
        self.waits += 1
        raise TimeoutError("simulated wait timeout")

    def get(self, call_id: str) -> dict:
        assert call_id == "known-call-1"
        self.gets += 1
        if self.read_error:
            raise self.read_error
        value = self.payload(terminal=not self.pending)
        if self.terminal_mismatch:
            value["recipients"][0]["phones"] = ["+15550101999"]
        return value

    def payload(self, *, terminal: bool) -> dict:
        recipient = copy.deepcopy(self.request["recipients"][0])
        recipient.update(
            {
                "status": "completed" if terminal else "pending",
                "structured_result": completed_result() if terminal else None,
                "attempts": [{"phone": recipient["phones"][0]}] if terminal else [],
            }
        )
        return {
            "id": "known-call-1",
            "task": self.request["task"],
            "metadata": self.request["metadata"],
            "recipients": [recipient],
            "status": "completed" if terminal else "queued",
            "task_completed": terminal,
        }


class StubClient:
    def __init__(self, calls: RecoverableCalls) -> None:
        self.calls = calls

    def close(self) -> None:
        pass
