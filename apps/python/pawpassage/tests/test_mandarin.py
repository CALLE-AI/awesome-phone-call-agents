from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from pawpassage.approval import ApprovalError, create_approval, verify_approval
from pawpassage.calle_transport import OfficialCalleTransport
from pawpassage.fake_server import FakeCalleServer
from pawpassage.ledger import CallLedger
from pawpassage.models import ContractError, parse_case
from pawpassage.preview import build_preview, preview_digest
from pawpassage.workflow import PawPassageWorkflow
from tests.helpers import ROOT, completed_result


class MandarinTests(unittest.TestCase):
    def template(self) -> dict:
        return json.loads(
            (ROOT / "examples" / "mandarin_smoke.template.json").read_text(
                encoding="utf-8"
            )
        )

    def test_template_cannot_be_used_as_a_dialable_case(self) -> None:
        with self.assertRaises(ContractError):
            parse_case(self.template())

    def test_mandarin_opening_and_language_are_bound_to_approval(self) -> None:
        raw = self.template()
        raw["checkpoints"][0]["phone_e164"] = "+60100000000"  # Local tests only.
        case = parse_case(raw)
        preview = build_preview(case, case.checkpoints[0])
        self.assertEqual((preview["region"], preview["locale"]), ("MY", "zh-CN"))
        self.assertIn("Speak Mandarin Chinese (Putonghua)", preview["task"])
        self.assertIn("disclosure in Mandarin Chinese (Putonghua)", preview["task"])
        self.assertIn("Do you consent to continue?", preview["task"])
        self.assertNotIn("say exactly: Hello", preview["task"])
        approval = create_approval(
            preview,
            presented_digest=preview_digest(preview),
            approved_by="test",
            mode="fake",
        )
        raw["checkpoints"][0]["locale"] = "en-US"
        changed = parse_case(raw)
        with self.assertRaises(ApprovalError):
            verify_approval(
                build_preview(changed, changed.checkpoints[0]),
                approval,
                required_mode="fake",
            )

    def test_official_sdk_round_trip_preserves_malaysia_mandarin_and_contradiction(
        self,
    ) -> None:
        raw = self.template()
        raw["checkpoints"][0]["phone_e164"] = (
            "+60100000000"  # Never sent outside loopback.
        )
        case = parse_case(raw)
        scripts = {
            "MANDARIN_TEST": {
                "kind": "completed",
                "result": completed_result(
                    propositions={
                        "P1": "CONFIRMED",
                        "P2": "CONTRADICTED",
                        "P3": "CONFIRMED",
                    }
                ),
            }
        }
        with (
            tempfile.TemporaryDirectory() as temporary,
            FakeCalleServer(scripts) as server,
        ):
            workflow = PawPassageWorkflow(CallLedger(Path(temporary) / "calls.sqlite3"))
            checkpoint = case.checkpoints[0]
            preview = workflow.prepare(case, checkpoint)
            approval = create_approval(
                preview,
                presented_digest=preview_digest(preview),
                approved_by="test",
                mode="fake",
            )
            report = workflow.execute(
                case=case,
                checkpoint=checkpoint,
                approval=approval,
                transport=OfficialCalleTransport(
                    api_key="demo-fake-key", base_url=server.base_url, live=False
                ),
                mode="fake",
                poll_interval_seconds=0.001,
                poll_timeout_seconds=2,
            )
            self.assertEqual(
                (server.snapshot().create_requests, server.snapshot().read_requests),
                (1, 1),
            )
        self.assertEqual(report.disposition, "GAPS_FOUND")
        self.assertEqual(report.reason_codes, ("P2_CONTRADICTED",))
