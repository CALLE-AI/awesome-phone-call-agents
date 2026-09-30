from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any

from pawpassage.approval import create_approval
from pawpassage.calle_transport import DispatchBinding, OfficialCalleTransport
from pawpassage.demo import DEMO_RESULTS
from pawpassage.fake_server import FakeCalleServer
from pawpassage.ledger import CallLedger
from pawpassage.models import parse_case
from pawpassage.preview import build_preview, preview_digest
from pawpassage.workflow import PawPassageWorkflow, journey_disposition
from tests.helpers import completed_result, raw_case


class TransportAndWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.case = parse_case(raw_case())
        self.temporary = tempfile.TemporaryDirectory(prefix="pawpassage-workflow-test-")
        self.workflow = PawPassageWorkflow(
            CallLedger(Path(self.temporary.name) / "ledger.sqlite3")
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_official_sdk_hits_fake_create_and_read_endpoints(self) -> None:
        checkpoint = self.case.checkpoint("AIRLINE_DESK")
        with FakeCalleServer(DEMO_RESULTS) as server:
            transport = OfficialCalleTransport(
                api_key="demo-fake-key", base_url=server.base_url, live=False
            )
            report = self._execute(checkpoint.checkpoint_id, transport)
            snapshot = server.snapshot()
        self.assertEqual(report.disposition, "EVIDENCE_PACKET_READY")
        self.assertEqual(snapshot.create_requests, 1)
        self.assertEqual(snapshot.read_requests, 1)
        self.assertEqual(snapshot.unique_calls, 1)

    def test_duplicate_success_does_not_hit_provider_twice(self) -> None:
        with FakeCalleServer(DEMO_RESULTS) as server:
            transport = OfficialCalleTransport(
                api_key="demo-fake-key", base_url=server.base_url, live=False
            )
            first = self._execute("AIRLINE_DESK", transport)
            second = self._execute("AIRLINE_DESK", transport)
            snapshot = server.snapshot()
        self.assertFalse(first.duplicate_prevented)
        self.assertTrue(second.duplicate_prevented)
        self.assertEqual(snapshot.create_requests, 1)

    def test_submission_unknown_is_durable_and_cannot_redial(self) -> None:
        with FakeCalleServer(DEMO_RESULTS) as server:
            transport = OfficialCalleTransport(
                api_key="demo-fake-key", base_url=server.base_url, live=False
            )
            first = self._execute("VET_SERVICE", transport)
            second = self._execute("VET_SERVICE", transport)
            snapshot = server.snapshot()
        self.assertEqual(first.ledger_state, "SUBMISSION_UNKNOWN")
        self.assertEqual(first.disposition, "NEEDS_HUMAN_RECONCILIATION")
        self.assertTrue(second.duplicate_prevented)
        self.assertEqual(snapshot.create_requests, 1)
        self.assertEqual(snapshot.unique_calls, 0)

    def test_contradicted_proposition_becomes_route_gap(self) -> None:
        with FakeCalleServer(DEMO_RESULTS) as server:
            transport = OfficialCalleTransport(
                api_key="demo-fake-key", base_url=server.base_url, live=False
            )
            report = self._execute("DESTINATION_AUTHORITY", transport)
        self.assertEqual(report.disposition, "GAPS_FOUND")
        self.assertEqual(report.reason_codes, ("P1_CONTRADICTED",))

    def test_journey_never_turns_partial_evidence_into_clearance(self) -> None:
        class Report:
            def __init__(self, disposition: str) -> None:
                self.disposition = disposition

        self.assertEqual(
            journey_disposition(
                [Report("EVIDENCE_PACKET_READY"), Report("GAPS_FOUND")]
            ),  # type: ignore[list-item]
            "ROUTE_GAPS_REQUIRE_HUMAN_ACTION",
        )
        self.assertEqual(
            journey_disposition([Report("EVIDENCE_PACKET_READY")]),  # type: ignore[list-item]
            "EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW",
        )

    def test_live_transport_rejects_non_official_or_credentialed_base_urls(
        self,
    ) -> None:
        invalid = [
            "http://127.0.0.1:8000",
            "https://example.com",
            "https://user:pass@api.heycall-e.com",
            "https://api.heycall-e.com/v1",
        ]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                OfficialCalleTransport(api_key="offline", base_url=value, live=True)

    def test_fake_transport_rejects_non_loopback_hosts(self) -> None:
        with self.assertRaisesRegex(ValueError, "loopback"):
            OfficialCalleTransport(
                api_key="offline", base_url="https://example.com", live=False
            )

    def test_transport_rejects_binding_mismatch_and_never_polls(self) -> None:
        checkpoint = self.case.checkpoint("AIRLINE_DESK")
        preview = build_preview(self.case, checkpoint)
        binding = DispatchBinding(
            task=preview["task"],
            phone_e164=checkpoint.phone_e164,
            region=checkpoint.region,
            locale=checkpoint.locale,
            result_schema=preview["recipientResultSchema"],
            metadata={"workflow": "pawpassage"},
            idempotency_key="intent",
        )
        calls = _CallsStub(
            created={
                "id": "call-1",
                "task": "different task",
                "metadata": {"workflow": "pawpassage"},
                "recipients": [{"phones": [checkpoint.phone_e164], "attempts": []}],
            }
        )
        transport = OfficialCalleTransport(
            api_key="offline",
            base_url="http://127.0.0.1:9",
            live=False,
            client_factory=lambda _key, _url: _ClientStub(calls),
        )
        outcome = transport.submit(binding)
        self.assertEqual(outcome.kind, "AMBIGUOUS")
        self.assertEqual(outcome.reason_code, "TASK_BINDING_MISMATCH")
        self.assertEqual(calls.wait_count, 0)

    def test_malformed_structured_result_routes_to_human(self) -> None:
        scripts = {
            "AIRLINE_DESK": {
                "kind": "completed",
                "result": {**completed_result(), "unexpected": "field"},
            }
        }
        with FakeCalleServer(scripts) as server:
            transport = OfficialCalleTransport(
                api_key="demo-fake-key", base_url=server.base_url, live=False
            )
            report = self._execute("AIRLINE_DESK", transport)
        self.assertEqual(report.ledger_state, "NEEDS_HUMAN")
        self.assertEqual(report.disposition, "NEEDS_HUMAN_REVIEW")
        self.assertIn("RESULT_KEYS_MISMATCH", report.reason_codes)

    def _execute(self, checkpoint_id: str, transport: OfficialCalleTransport):
        checkpoint = self.case.checkpoint(checkpoint_id)
        preview = self.workflow.prepare(self.case, checkpoint)
        approval = create_approval(
            preview,
            presented_digest=preview_digest(preview),
            approved_by="test-operator",
            mode="fake",
        )
        return self.workflow.execute(
            case=self.case,
            checkpoint=checkpoint,
            approval=approval,
            transport=transport,
            mode="fake",
            poll_interval_seconds=0.001,
            poll_timeout_seconds=2,
        )


class _CallsStub:
    def __init__(self, created: dict[str, Any]) -> None:
        self.created = created
        self.wait_count = 0

    def create(self, **_kwargs: Any) -> dict[str, Any]:
        return self.created

    def wait_for_result(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
        self.wait_count += 1
        return {}

    def get(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return {}


class _ClientStub:
    def __init__(self, calls: _CallsStub) -> None:
        self.calls = calls

    def close(self) -> None:
        return


if __name__ == "__main__":
    unittest.main()
