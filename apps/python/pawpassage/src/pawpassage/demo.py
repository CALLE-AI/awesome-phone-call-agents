from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from .approval import create_approval
from .calle_transport import OfficialCalleTransport
from .fake_server import FakeCalleServer
from .ledger import CallLedger
from .models import JourneyCase, load_case
from .preview import preview_digest
from .report import build_demo_packet, write_demo_reports
from .workflow import PawPassageWorkflow, journey_disposition

DEMO_RESULTS: dict[str, dict[str, Any]] = {
    "AIRLINE_DESK": {
        "kind": "completed",
        "result": {
            "schemaVersion": "1.0",
            "contactOutcome": "REACHED",
            "roleMatch": "YES",
            "propositions": {"P1": "CONFIRMED", "P2": "CONFIRMED", "P3": "CONFIRMED"},
            "writtenReference": "OFFERED",
            "commitmentRequested": "NO",
        },
    },
    "DESTINATION_AUTHORITY": {
        "kind": "completed",
        "result": {
            "schemaVersion": "1.0",
            "contactOutcome": "REACHED",
            "roleMatch": "YES",
            "propositions": {
                "P1": "CONTRADICTED",
                "P2": "CONFIRMED",
                "P3": "CONFIRMED",
            },
            "writtenReference": "OFFERED",
            "commitmentRequested": "NO",
        },
    },
    "VET_SERVICE": {"kind": "submission_unknown"},
}


def run_demo(
    case_path: str | Path, output_dir: str | Path
) -> tuple[dict[str, Any], Path, Path]:
    case = load_case(case_path)
    with tempfile.TemporaryDirectory(prefix="pawpassage-demo-") as temporary:
        workflow = PawPassageWorkflow(CallLedger(Path(temporary) / "demo.sqlite3"))
        reports = []
        duplicate_checks = []
        with FakeCalleServer(DEMO_RESULTS) as server:
            transport = OfficialCalleTransport(
                api_key="demo-fake-key",
                base_url=server.base_url,
                live=False,
            )
            for checkpoint in case.checkpoints:
                approval = _demo_approval(workflow, case, checkpoint.checkpoint_id)
                report = workflow.execute(
                    case=case,
                    checkpoint=checkpoint,
                    approval=approval,
                    transport=transport,
                    mode="fake",
                    poll_interval_seconds=0.001,
                    poll_timeout_seconds=2,
                )
                reports.append(report)
                if checkpoint.checkpoint_id in {"AIRLINE_DESK", "VET_SERVICE"}:
                    duplicate_checks.append(
                        workflow.execute(
                            case=case,
                            checkpoint=checkpoint,
                            approval=approval,
                            transport=transport,
                            mode="fake",
                            poll_interval_seconds=0.001,
                            poll_timeout_seconds=2,
                        )
                    )
            snapshot = server.snapshot()

        packet = build_demo_packet(
            route_label=case.route_label,
            overall_disposition=journey_disposition(reports),
            reports=[report.to_dict() for report in reports],
            duplicate_checks=[report.to_dict() for report in duplicate_checks],
            fake_server={
                "createRequests": snapshot.create_requests,
                "readRequests": snapshot.read_requests,
                "uniqueCalls": snapshot.unique_calls,
            },
        )
        json_path, html_path = write_demo_reports(output_dir, packet)
    return packet, json_path, html_path


def _demo_approval(workflow: PawPassageWorkflow, case: JourneyCase, checkpoint_id: str):
    checkpoint = case.checkpoint(checkpoint_id)
    preview = workflow.prepare(case, checkpoint)
    return create_approval(
        preview,
        presented_digest=preview_digest(preview),
        approved_by="fictional-demo-operator",
        mode="fake",
    )
