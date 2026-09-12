"""Offline regressions for the documented CALL-E CLI 0.5.1 envelopes."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verifier = load("verify_result")
runner = load("run_task")


def mcp(status="COMPLETED", **extra):
    return {"ok": True, "tool_name": "get_call_run", "result": {
        "structuredContent": {"status": status, **extra}}}


class CLIEnvelopeTests(unittest.TestCase):
    def assert_gate(self, payload, expected_status, allowed):
        self.assertEqual(runner.provider_envelopes(payload), verifier.provider_envelopes(payload))
        self.assertEqual(runner._display_status(payload), expected_status)
        self.assertEqual(verifier.provider_blocks_verification(payload) is None, allowed)

    def test_current_mcp_status_wrapper(self):
        self.assert_gate(mcp(), "COMPLETED", True)

    def test_workflow_latest_status_ignores_initial_run_acknowledgement(self):
        self.assert_gate({"ok": True, "tool_name": "run_call", "call_started": True,
                          "run_id": "fixture-run", "run_result": {"structuredContent": {
                              "status": "QUEUED"}}, "status_result": {
                              "structuredContent": {"status": "COMPLETED"}}},
                         "COMPLETED", True)

    def test_arbitrary_nested_status_cannot_prove_completion(self):
        for payload in [
            {"ok": True, "result": {"status": "COMPLETED"}},
            {"ok": True, "result": {"structuredContent": {"status": "COMPLETED"}}},
            {"ok": True, "tool_name": "plan_call", "result": {
                "structuredContent": {"status": "COMPLETED"}}},
            {"ok": True, "tool_name": "run_call", "call_started": False,
             "run_id": "fixture-run", "status_result": {
                 "structuredContent": {"status": "COMPLETED"}}},
        ]:
            with self.subTest(payload=payload):
                self.assert_gate(payload, "UNKNOWN", False)

    def test_authoritative_failures_remain_dominant(self):
        self.assert_gate({**mcp(), "status": "FAILED"}, "FAILED", False)
        self.assert_gate(mcp("IN_PROGRESS"), "IN_PROGRESS", False)
        self.assert_gate({**mcp(), "ok": False}, "COMPLETED", False)
        self.assert_gate(mcp(ok=False), "COMPLETED", False)

    def test_domain_status_does_not_veto_completed_call(self):
        self.assert_gate(mcp(metadata={"status": "FAILED"}), "COMPLETED", True)

    def test_each_poll_sample_is_persisted_and_masked(self):
        phone = "+12025550123"
        samples = [mcp("IN_PROGRESS", summary=phone), mcp(summary=phone)]
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(runner, "run_calle", side_effect=samples) as provider, \
                    patch.object(runner.time, "sleep"), contextlib.redirect_stdout(io.StringIO()):
                result = runner.poll_until_terminal("fixture-run", [phone], Path(directory))
            self.assertEqual(result, samples[-1])
            self.assertEqual(provider.call_count, 2)
            files = sorted((Path(directory) / "status-snapshots").glob("*.json"))
            self.assertEqual(len(files), 2)
            observed = []
            for path in files:
                self.assertNotIn(phone, path.read_text())
                saved = json.loads(path.read_text())
                self.assertTrue(saved["observed_at"])
                observed.append(runner._display_status(saved["response"]))
            self.assertEqual(observed, ["IN_PROGRESS", "COMPLETED"])

    def test_cli_disables_telemetry(self):
        completed = subprocess.CompletedProcess([], 0, '{"ok":true}', "")
        with patch.object(runner.subprocess, "run", return_value=completed) as invoke:
            self.assertEqual(runner.run_calle(["call", "status", "--run-id", "fixture-run"]), {"ok": True})
        self.assertIn("--no-telemetry", invoke.call_args.args[0])

    def test_recorded_task_ends_without_waiting_for_a_person(self):
        task = json.loads((ROOT / "tests/fixtures/task.json").read_text())
        task["line_type"] = "recorded"
        instructions = runner.render_instructions(task, {"found": False})
        self.assertIn("Do not choose an operator or human route", instructions)
        self.assertIn("End after capturing the requested content", instructions)
        self.assertIn("Do not wait in a human queue", instructions)
        self.assertNotIn("Do not hang up early", instructions)
        self.assertNotIn("Wait silently until a human", instructions)
        task["line_type"] = "unknown"
        conversational = runner.render_instructions(task, {"found": False})
        self.assertIn("Do not hang up early", conversational)
        self.assertIn("Wait silently until a human", conversational)

    def test_preview_does_not_invent_a_fixed_call_price(self):
        task = json.loads((ROOT / "tests/fixtures/task.json").read_text())
        preview = runner.preview_text(task, "fixture instructions", {"found": False})
        self.assertIn("determined by the current provider plan", preview)
        self.assertNotIn("1 call credit", preview)


if __name__ == "__main__":
    unittest.main()
