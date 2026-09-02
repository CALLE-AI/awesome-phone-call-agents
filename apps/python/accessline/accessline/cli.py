#!/usr/bin/env python3
"""Local CLI for AccessLine mock/demo runs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from accessline.adapter import CallEAdapter, MockCallEProvider
from accessline.schema import AccessLineInput, validate_result
from accessline.workflow import AccessLineWorkflow, ConsentRequired


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _input_from_fixture(payload: dict) -> tuple[AccessLineInput, dict, str | None]:
    input_payload = payload.get("input") or {}
    mock_response = payload.get("mock_response") or {}
    transcript = payload.get("mock_transcript")
    return (
        AccessLineInput(
            venue_name=str(input_payload.get("venue_name") or ""),
            phone_number=str(input_payload.get("phone_number") or ""),
            visit_date=input_payload.get("visit_date"),
            consent_confirmed=bool(input_payload.get("consent_confirmed")),
            live_run_id=input_payload.get("live_run_id"),
            live_authorized_destination_e164=input_payload.get(
                "live_authorized_destination_e164"
            ),
            live_action=input_payload.get("live_action"),
        ),
        mock_response,
        transcript,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AccessLine local mock CLI")
    parser.add_argument("--fixture", required=True, help="Path to deterministic demo fixture JSON")
    parser.add_argument(
        "--mode",
        choices=("mock", "preview-live"),
        default="mock",
        help="mock consumes fixture mock_response; preview-live shows blocked live path",
    )
    parser.add_argument(
        "--include-transcript",
        action="store_true",
        help="Opt-in debug: include transcript body in mock output (disabled by default)",
    )
    args = parser.parse_args(argv)
    fixture_path = Path(args.fixture)
    payload = _load_fixture(fixture_path)
    input_data, mock_response, transcript = _input_from_fixture(payload)

    if args.mode == "preview-live":
        workflow = AccessLineWorkflow()
        try:
            preview = workflow.preview_blocked_live_path(input_data)
        except ConsentRequired as exc:
            print(json.dumps({"error": str(exc), "consent_gate": "BLOCKED"}, indent=2))
            return 2
        print(json.dumps(preview, indent=2, sort_keys=True))
        return 0

    provider = MockCallEProvider(mock_response, transcript=transcript)
    workflow = AccessLineWorkflow(adapter=CallEAdapter(provider=provider))
    try:
        artifacts = workflow.run_mock(input_data, mock_response, transcript=transcript)
    except ConsentRequired as exc:
        print(json.dumps({"error": str(exc), "consent_gate": "BLOCKED"}, indent=2))
        return 2
    output = workflow.artifacts_to_dict(
        artifacts, include_transcript=bool(args.include_transcript)
    )
    output["mode"] = "MOCK"
    output["real_call_performed"] = False
    output["fixture_kind"] = payload.get("fixture_kind", "FICTIONAL_TEST_DATA")
    output["synthetic"] = bool(payload.get("synthetic", True))
    print(json.dumps(output, indent=2, sort_keys=True))
    validate_result(output["structured_output"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
