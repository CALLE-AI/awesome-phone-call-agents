"""Offline regression checks for the live destination and masked-output boundary."""

import ast
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("run_task.py")
spec = importlib.util.spec_from_file_location("holdfast_runner", SOURCE)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

# Standards-reserved fictional contacts. All provider operations below are mocked.
PHONE = "+12025550123"
OTHER_PHONE = "+12025550124"


def task():
    return {
        "callee": PHONE,
        "goal": "Ask about the fictional callback " + PHONE,
        "user_name": "Example Operator",
        "context": {"callback": PHONE},
        "success_criteria": ["availability"],
        "authorization_scope": {
            "may_provide": ["callback " + PHONE],
            "may_confirm": [],
            "must_not": ["payments"],
        },
    }


class RunnerSafetyTests(unittest.TestCase):
    def setUp(self):
        # Keep the global dialing ledger inside a temp file so the suite is
        # hermetic: no ~/.cache writes, no state leaking between runs.
        self._ledger_tmp = tempfile.TemporaryDirectory(prefix="holdfast-legacy-")
        self._old_ledger = os.environ.get("HOLDFAST_LEDGER")
        os.environ["HOLDFAST_LEDGER"] = str(Path(self._ledger_tmp.name) / "ledger.json")

    def tearDown(self):
        if self._old_ledger is None:
            os.environ.pop("HOLDFAST_LEDGER", None)
        else:
            os.environ["HOLDFAST_LEDGER"] = self._old_ledger
        self._ledger_tmp.cleanup()

    def assert_masked(self, value):
        text = str(value)
        self.assertNotIn(PHONE, text)
        self.assertNotIn(OTHER_PHONE, text)

    def test_source_does_not_require_python_312_f_strings(self):
        ast.parse(SOURCE.read_text(), feature_version=(3, 9))

    def test_exact_ascii_e164(self):
        self.assertEqual(runner.validate_task(task()), [])
        for number in (PHONE + "\n", PHONE + " ", "  " + PHONE,
                       "+１２０２５５５０１２３", "+1202555١٢٣", "2025550123"):
            with self.subTest(number=number):
                self.assertTrue(runner.validate_task({**task(), "callee": number}))

    def test_preview_masks_context_without_mutating_task(self):
        original = task()
        instructions = runner.render_instructions(original, {"found": False})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            runner.print_preview(original, instructions, {"found": False})
        self.assert_masked(output.getvalue())
        self.assertEqual(original["callee"], PHONE)
        self.assertIn(PHONE, instructions)

    def test_default_preview_artifacts_are_masked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input.json"
            source.write_text(json.dumps(task()))
            output_dir = root / "output"
            output = io.StringIO()
            argv = [str(SOURCE), "--task", str(source), "--out", str(output_dir)]
            with patch.object(sys, "argv", argv), patch.object(runner, "lookup_map", return_value={"found": False}), patch.object(runner, "run_calle") as provider, contextlib.redirect_stdout(output):
                runner.main()
            provider.assert_not_called()
            self.assert_masked(output.getvalue())
            for name in ("task.json", "instructions.txt"):
                self.assert_masked((output_dir / name).read_text())
            self.assertEqual(json.loads(source.read_text())["callee"], PHONE)

    def test_live_argument_is_exact_and_provider_outputs_masked(self):
        start = {"ok": True, "call_started": True, "run_id": "synthetic-run", "to_phone": PHONE, "context": PHONE}
        final = {"status": "COMPLETED", "summary": "Callback " + PHONE, "transcript": "Other callback " + OTHER_PHONE, "activity": [{"message": "Reached " + PHONE}]}
        with tempfile.TemporaryDirectory() as directory, patch.object(runner, "run_calle", side_effect=[start, final]) as provider, patch.object(runner.time, "sleep"), contextlib.redirect_stdout(io.StringIO()) as output:
            result = runner.do_run(task(), "Private callback " + PHONE, Path(directory))
            arguments = provider.call_args_list[0].args[0]
            self.assertEqual(arguments[arguments.index("--to-phone") + 1], PHONE)
            self.assertEqual(arguments[arguments.index("--goal") + 1], "Private callback " + PHONE)
            self.assertEqual(provider.call_count, 2)
            self.assert_masked(result)
            self.assert_masked(output.getvalue())
            for name in ("start.json", "final.json", "destination-check.json"):
                self.assert_masked((Path(directory) / name).read_text())

    def test_failed_start_details_masked_and_no_poll(self):
        failed = {"ok": False, "error": {"message": "Rejected " + PHONE + " alternate " + OTHER_PHONE}}
        with tempfile.TemporaryDirectory() as directory, patch.object(runner, "run_calle", return_value=failed) as provider, contextlib.redirect_stderr(io.StringIO()) as error:
            with self.assertRaises(SystemExit):
                runner.do_run(task(), "private " + PHONE, Path(directory))
            self.assertEqual(provider.call_count, 1)
            self.assert_masked(error.getvalue())
            self.assert_masked((Path(directory) / "start.json").read_text())

    def test_mismatched_destination_stops_without_poll(self):
        start = {"ok": True, "call_started": True, "run_id": "synthetic-run", "to_phone": OTHER_PHONE}
        with tempfile.TemporaryDirectory() as directory, patch.object(runner, "run_calle", return_value=start) as provider, contextlib.redirect_stderr(io.StringIO()) as error:
            with self.assertRaises(SystemExit):
                runner.do_run(task(), "private", Path(directory))
            self.assertEqual(provider.call_count, 1)
            self.assert_masked(error.getvalue())

    def test_timeout_does_not_echo_private_command(self):
        timeout = subprocess.TimeoutExpired(["calle", "--to-phone", PHONE], 200)
        with patch.object(runner.subprocess, "run", side_effect=timeout) as provider, contextlib.redirect_stderr(io.StringIO()) as error:
            with self.assertRaises(SystemExit):
                runner.run_calle(["call", "start", "--to-phone", PHONE])
            self.assertEqual(provider.call_count, 1)
            self.assert_masked(error.getvalue())

    def test_legacy_verification_and_report_outputs_masked(self):
        report = {"overall": "verified " + PHONE, "fields": {"callback": {"value": PHONE, "verdict": "verified"}}}
        final = {"status": "COMPLETED", "call_id": "callback-" + PHONE, "transcript": OTHER_PHONE}
        process = subprocess.CompletedProcess([], 0, stdout=json.dumps(report), stderr="")
        with tempfile.TemporaryDirectory() as directory, patch.object(runner.subprocess, "run", return_value=process), contextlib.redirect_stdout(io.StringIO()) as output:
            checked = runner.do_verify(final, Path(directory), runner.callee_variants(PHONE))
            runner.print_report(task(), final, report)
            self.assert_masked(checked)
            self.assert_masked((Path(directory) / "verification.json").read_text())
            self.assert_masked(output.getvalue())


if __name__ == "__main__":
    unittest.main()
