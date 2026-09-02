#!/usr/bin/env python3
"""Tests for language-bridge-call. Fixture mode only: no network, no calle, no credentials."""

from __future__ import annotations

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "scripts"))

import relay_call  # noqa: E402

SAMPLE = SKILL / "assets" / "sample-relay-request.json"
HAPPY = SKILL / "scripts" / "fixtures" / "relay_happy_path.json"


def run_main(argv: list[str]) -> tuple[int, str]:
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = relay_call.main(argv)
    return code, buffer.getvalue()


def capture_stderr(argv: list[str]) -> tuple[int, str]:
    err = io.StringIO()
    with mock.patch("sys.stderr", err):
        code = relay_call.main(argv)
    return code, err.getvalue()


class UnitTests(unittest.TestCase):
    def test_mask_phone(self):
        self.assertEqual(relay_call.mask_phone("+14085550142"), "+140••••0142")
        self.assertEqual(relay_call.mask_phone("+1"), "••••")

    def test_reject_missing_consent(self):
        req = json.loads(SAMPLE.read_text())
        req["consent"] = False
        path = write_temp(req)
        code, _ = run_main(["--request", str(path)])
        self.assertEqual(code, 2)

    def test_reject_non_e164(self):
        req = json.loads(SAMPLE.read_text())
        req["recipient"]["phone"] = "555-0163"
        path = write_temp(req)
        code, _ = run_main(["--request", str(path)])
        self.assertEqual(code, 2)

    def test_reject_same_phones(self):
        req = json.loads(SAMPLE.read_text())
        req["recipient"]["phone"] = req["requester"]["phone"]
        path = write_temp(req)
        code, _ = run_main(["--request", str(path)])
        self.assertEqual(code, 2)

    def test_reject_too_many_windows(self):
        req = json.loads(SAMPLE.read_text())
        req["proposed_windows"] = ["2026-09-08T09:00:00-07:00"] * 5
        path = write_temp(req)
        code, _ = run_main(["--request", str(path)])
        self.assertEqual(code, 2)

    def test_preview_masks_numbers(self):
        code, out = run_main(["--request", str(SAMPLE)])
        self.assertEqual(code, 0)
        self.assertNotIn("+14085550142", out)
        self.assertNotIn("+14085550163", out)
        self.assertIn("+140••••0142", out)
        self.assertIn("no calls placed", out)


class FixtureTests(unittest.TestCase):
    def test_happy_path_agrees(self):
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(HAPPY)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "agreed")
        self.assertEqual(result["agreed_window"], "2026-09-08T15:00:00-07:00")
        self.assertEqual(result["calls_placed"], 2)
        self.assertIsNone(result["needs_human_reason"])

    def test_recipient_no_answer_fails_closed_after_one_call(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["rec_status"]["result"]["structuredContent"]["status"] = "NO_ANSWER"
        canned["rec_status"]["result"]["structuredContent"].pop("structured_output")
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertEqual(result["calls_placed"], 1)
        self.assertEqual(result["recipient_call"]["disposition"], "no_answer")
        self.assertEqual(result["requester_call"]["disposition"], "skipped")

    def test_recipient_choice_outside_windows_fails_closed(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["rec_status"]["result"]["structuredContent"]["structured_output"]["choice"] = "2026-12-25T09:00:00-07:00"
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertEqual(result["calls_placed"], 1)
        self.assertEqual(result["recipient_call"]["disposition"], "schema_drift")

    def test_requester_declines_counter(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["req_status"]["result"]["structuredContent"]["structured_output"] = {
            "accepted": False, "agreed_window": "", "notes": "Not Monday."
        }
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertEqual(result["calls_placed"], 2)

    def test_plan_not_ready_fails_closed(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["rec_plan"]["result"]["structuredContent"] = {"plan_id": "p1", "ready_to_run": False}
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertEqual(result["calls_placed"], 1)

    def test_output_carries_no_secrets(self):
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(HAPPY)])
        self.assertEqual(code, 0)
        self.assertNotIn("ctok_", out)

    def test_missing_consent_fails_closed(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["rec_status"]["result"]["structuredContent"]["structured_output"].pop("consent_given")
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertEqual(result["calls_placed"], 1)
        self.assertEqual(result["recipient_call"]["disposition"], "no_consent")
        self.assertEqual(result["requester_call"]["disposition"], "skipped")

    def test_answer_type_drift_fails_closed(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["rec_status"]["result"]["structuredContent"]["structured_output"]["understood"] = "true"
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertEqual(result["calls_placed"], 1)
        self.assertEqual(result["recipient_call"]["disposition"], "schema_drift")

    def test_low_confidence_fails_closed(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["rec_status"]["result"]["structuredContent"]["structured_output"]["confidence"] = 0.3
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertEqual(result["calls_placed"], 1)
        self.assertEqual(result["recipient_call"]["disposition"], "low_confidence")

    def test_requester_answer_type_drift_fails_closed(self):
        canned = copy.deepcopy(json.loads(HAPPY.read_text()))
        canned["req_status"]["result"]["structuredContent"]["structured_output"]["accepted"] = "true"
        path = write_temp(canned)
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(path)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["relay"], "needs_human")
        self.assertIn("schema validation", result["needs_human_reason"])

    def test_execute_refuses_repeated_request(self):
        with tempfile.TemporaryDirectory() as state_dir:
            env = {"LANGUAGE_BRIDGE_CALL_STATE_DIR": state_dir}
            with mock.patch.dict(os.environ, env):
                relay_call.write_state("relay-2026-09-08-unit-12", {"status": "done"})
                code, err = capture_stderr(["--request", str(SAMPLE), "--execute", "--confirm-consent"])
                self.assertEqual(code, 2)
                self.assertIn("refusing to re-run", err)
                self.assertIn("status: done", err)


def write_temp(data) -> str:
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(data, handle)
    handle.close()
    return handle.name


if __name__ == "__main__":
    unittest.main()
