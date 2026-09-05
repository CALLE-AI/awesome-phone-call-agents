#!/usr/bin/env python3
"""Tests for agency-status-watch. Fixture mode only: no network, no calle, no credentials."""

from __future__ import annotations

import copy
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

APP = Path(__file__).resolve().parents[0]
sys.path.insert(0, str(APP))

import status_watch  # noqa: E402

SAMPLE = APP / "example-watch-request.json"
HAPPY = APP / "scripts" / "fixtures" / "watch_happy_path.json"


def run_main(argv: list[str]) -> tuple[int, str]:
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        code = status_watch.main(argv)
    return code, buffer.getvalue()


def capture_stderr(argv: list[str]) -> tuple[int, str]:
    err = io.StringIO()
    with mock.patch("sys.stderr", err):
        code = status_watch.main(argv)
    return code, err.getvalue()


def write_temp(data) -> str:
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(data, handle)
    handle.close()
    return handle.name


def fixture_with(mutate) -> str:
    canned = copy.deepcopy(json.loads(HAPPY.read_text()))
    mutate(canned)
    return write_temp(canned)


def parse_due(out: str) -> datetime:
    return datetime.fromisoformat(json.loads(out)["next_check_due"])


class UnitTests(unittest.TestCase):
    def test_mask_phone(self):
        self.assertEqual(status_watch.mask_phone("+14155550172"), "+141••••0172")
        self.assertEqual(status_watch.mask_phone("+1"), "••••")

    def test_mask_ref(self):
        self.assertEqual(status_watch.mask_ref("WPR-2026-08847-A"), "WP••••47-A")
        self.assertEqual(status_watch.mask_ref("ABC"), "••••••")

    def test_reject_missing_consent(self):
        req = json.loads(SAMPLE.read_text())
        req["consent"] = False
        code, _ = run_main(["--request", write_temp(req)])
        self.assertEqual(code, 2)

    def test_reject_non_e164_agency_phone(self):
        req = json.loads(SAMPLE.read_text())
        req["agency"]["phone"] = "555-0172"
        code, _ = run_main(["--request", write_temp(req)])
        self.assertEqual(code, 2)

    def test_reject_missing_reference(self):
        req = json.loads(SAMPLE.read_text())
        req["reference_number"] = ""
        code, _ = run_main(["--request", write_temp(req)])
        self.assertEqual(code, 2)

    def test_reject_bad_max_checks(self):
        req = json.loads(SAMPLE.read_text())
        req["max_checks"] = 11
        code, _ = run_main(["--request", write_temp(req)])
        self.assertEqual(code, 2)

    def test_preview_masks_numbers_and_places_no_calls(self):
        code, out = run_main(["--request", str(SAMPLE)])
        self.assertEqual(code, 0)
        self.assertNotIn("+14155550172", out)
        self.assertNotIn("WPR-2026-08847-A", out)
        self.assertIn("+141••••0172", out)
        self.assertIn("WP••••47-A", out)
        self.assertIn("no calls placed", out)

    def test_answer_schema_gates(self):
        base = {"status_category": "in_process", "ivr_reached": True, "next_action": "none",
                "confidence": 0.9, "spoke_with": "", "next_action_deadline": "", "notes": ""}
        self.assertEqual(status_watch.validate_answer_schema(base), "")
        bad = dict(base, status_category="maybe_fine")
        self.assertIn("not a known category", status_watch.validate_answer_schema(bad))
        no_ivr = dict(base, ivr_reached=False, status_category="not_found")
        self.assertEqual(status_watch.validate_answer_schema(no_ivr), "")  # not_found/wrong_dept allowed
        claimed = dict(no_ivr, status_category="approved")
        self.assertIn("ivr_reached", status_watch.validate_answer_schema(claimed))
        late = dict(base, next_action_deadline="september soon")
        self.assertIn("ISO", status_watch.validate_answer_schema(late))
        drift = dict(base, confidence="high")
        self.assertIn("confidence", status_watch.validate_answer_schema(drift))


class FixtureTests(unittest.TestCase):
    def test_happy_path_in_process_schedules_decay(self):
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(HAPPY)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "watching")
        self.assertEqual(result["check_number"], 1)
        due = parse_due(out)
        now = datetime.now(timezone.utc)
        self.assertTrue(now + timedelta(hours=23) <= due <= now + timedelta(hours=25))

    def test_approved_stops_the_watch(self):
        path = fixture_with(lambda c: c["check_status"]["result"]["structuredContent"]["structured_output"].update(
            {"status_category": "approved", "notes": "Your permit has been approved."}))
        code, out = run_main(["--request", str(SAMPLE), "--fixture", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "complete_approved")
        self.assertIsNone(result["next_check_due"])

    def test_more_info_needed_requires_action_and_stops(self):
        path = fixture_with(lambda c: c["check_status"]["result"]["structuredContent"]["structured_output"].update(
            {"status_category": "more_info_needed", "next_action": "Submit proof of address",
             "next_action_deadline": "2026-09-19"}))
        code, out = run_main(["--request", str(SAMPLE), "--fixture", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "action_required")
        self.assertIsNone(result["next_check_due"])

    def test_low_confidence_fails_closed_to_human(self):
        path = fixture_with(lambda c: c["check_status"]["result"]["structuredContent"]["structured_output"].update(
            {"confidence": 0.4}))
        code, out = run_main(["--request", str(SAMPLE), "--fixture", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "needs_human")
        self.assertIn("confidence", result["needs_human_reason"])

    def test_status_without_ivr_fails_closed(self):
        path = fixture_with(lambda c: c["check_status"]["result"]["structuredContent"]["structured_output"].update(
            {"ivr_reached": False}))
        code, out = run_main(["--request", str(SAMPLE), "--fixture", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "needs_human")
        self.assertIn("schema_drift", result["needs_human_reason"])

    def test_unknown_category_fails_closed(self):
        path = fixture_with(lambda c: c["check_status"]["result"]["structuredContent"]["structured_output"].update(
            {"status_category": "almost_done"}))
        code, out = run_main(["--request", str(SAMPLE), "--fixture", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "needs_human")

    def test_no_answer_retries_sooner_than_decay(self):
        path = fixture_with(lambda c: c["check_status"]["result"]["structuredContent"].update(
            {"status": "NO_ANSWER"}) or c["check_status"]["result"]["structuredContent"].pop("structured_output"))
        code, out = run_main(["--request", str(SAMPLE), "--fixture", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "watching")
        due = parse_due(out)
        now = datetime.now(timezone.utc)
        self.assertTrue(now + timedelta(hours=23) <= due <= now + timedelta(hours=25))

    def test_plan_not_ready_fails_closed(self):
        path = fixture_with(lambda c: c["check_plan"]["result"]["structuredContent"].update({"ready_to_run": False}))
        code, out = run_main(["--request", str(SAMPLE), "--fixture", path])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "needs_human")
        self.assertEqual(result["call"]["disposition"], "schema_drift")

    def test_second_check_uses_second_decay_step(self):
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(HAPPY)])
        self.assertEqual(code, 0)
        result = status_watch.check(json.loads(SAMPLE.read_text()) | {"_max_checks": 5},
                                    status_watch.FixtureRunner(json.loads(HAPPY.read_text())),
                                    checks_done=1)
        self.assertEqual(result["check_number"], 2)
        due = datetime.fromisoformat(result["next_check_due"])
        now = datetime.now(timezone.utc)
        self.assertTrue(now + timedelta(days=1, hours=23) <= due <= now + timedelta(days=2, hours=1))

    def test_budget_exhaustion_stops_after_max_checks(self):
        req = json.loads(SAMPLE.read_text())
        req["max_checks"] = 1
        code, out = run_main(["--request", write_temp(req), "--fixture", str(HAPPY)])
        self.assertEqual(code, 0)
        result = json.loads(out)
        self.assertEqual(result["watch"], "max_checks_reached")
        self.assertIsNone(result["next_check_due"])

    def test_output_carries_no_secrets(self):
        code, out = run_main(["--request", str(SAMPLE), "--fixture", str(HAPPY)])
        self.assertEqual(code, 0)
        self.assertNotIn("ctok_", out)


class StateTests(unittest.TestCase):
    def test_execute_refuses_before_due_and_after_cancel(self):
        with tempfile.TemporaryDirectory() as state_dir:
            env = {"AGENCY_STATUS_WATCH_STATE_DIR": state_dir}
            with mock.patch.dict(os.environ, env):
                req = json.loads(SAMPLE.read_text())
                due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
                status_watch.write_state(req["watch_id"], {
                    "status": "watching", "checks_done": 1, "max_checks": 5, "next_check_due": due})
                path = write_temp(req)
                code, err = capture_stderr(["--request", path, "--execute", "--confirm-consent"])
                self.assertEqual(code, 2)
                self.assertIn("due", err)
                status_watch.write_state(req["watch_id"], {"status": "cancelled", "next_check_due": None})
                code, err = capture_stderr(["--request", path, "--execute", "--confirm-consent"])
                self.assertEqual(code, 2)
                self.assertIn("cancelled", err)

    def test_execute_refuses_unknown_outcome_and_requires_consent(self):
        with tempfile.TemporaryDirectory() as state_dir:
            env = {"AGENCY_STATUS_WATCH_STATE_DIR": state_dir}
            with mock.patch.dict(os.environ, env):
                req = json.loads(SAMPLE.read_text())
                status_watch.write_state(req["watch_id"], {"status": "started", "checks_done": 0})
                path = write_temp(req)
                code, err = capture_stderr(["--request", path, "--execute", "--confirm-consent"])
                self.assertEqual(code, 2)
                self.assertIn("outcome unknown", err)
                code, err = capture_stderr(["--request", path, "--execute"])
                self.assertEqual(code, 2)
                self.assertIn("--confirm-consent", err)

    def test_cancel_marks_state_and_status_prints_it(self):
        with tempfile.TemporaryDirectory() as state_dir:
            env = {"AGENCY_STATUS_WATCH_STATE_DIR": state_dir}
            with mock.patch.dict(os.environ, env):
                req = json.loads(SAMPLE.read_text())
                status_watch.write_state(req["watch_id"], {"status": "watching", "checks_done": 2})
                path = write_temp(req)
                code, out = run_main(["--request", path, "--cancel"])
                self.assertEqual(code, 0)
                state = status_watch.read_state(req["watch_id"])
                self.assertEqual(state["status"], "cancelled")
                self.assertIsNone(state["next_check_due"])
                code, out = run_main(["--request", path, "--status"])
                self.assertEqual(code, 0)
                self.assertIn("cancelled", out)


if __name__ == "__main__":
    unittest.main()
