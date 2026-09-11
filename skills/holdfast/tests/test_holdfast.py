"""HoldFast offline acceptance tests.

Every test runs without CALL-E credentials and without network access. Tests
that exercise the real-call path install a fake `calle` executable earlier in
PATH and assert on its invocation log, so a regression that dials for real
fails here instead of on a live account.
"""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
RUN_TASK = ROOT / "scripts" / "run_task.py"
VERIFY = ROOT / "scripts" / "verify_result.py"
MAP_UPDATE = ROOT / "scripts" / "map_update.py"


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


run_task = load_script("run_task", RUN_TASK)
verify_result = load_script("verify_result", VERIFY)


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeCalle:
    """A fake `calle` CLI that logs every invocation and replays canned JSON."""

    def __init__(self, tmp: Path, start_response: dict):
        self.tmp = tmp
        self.bin = tmp / "bin"
        self.bin.mkdir()
        self.log = tmp / "calle.log"
        response_file = tmp / "start-response.json"
        response_file.write_text(json.dumps(start_response), encoding="utf-8")
        script = self.bin / "calle"
        script.write_text(
            "#!/bin/sh\n"
            f"echo \"invoked: $1 $2 $3 $4\" >> {self.log}\n"
            f"if [ \"$1 $2\" = 'call start' ]; then cat {response_file}; "
            "else echo '{\"ok\": true, \"status\": \"COMPLETED\"}'; fi\n",
            encoding="utf-8",
        )
        script.chmod(script.stat().st_mode | stat.S_IEXEC)

    def env(self):
        env = dict(os.environ)
        env["PATH"] = f"{self.bin}{os.pathsep}{env['PATH']}"
        return env

    def invocation_count(self):
        if not self.log.exists():
            return 0
        return sum(
            1 for line in self.log.read_text(encoding="utf-8").splitlines()
            if line.startswith("invoked:")
        )

    def saw(self, needle: str) -> bool:
        return self.log.exists() and needle in self.log.read_text(encoding="utf-8")


class ValidateTaskTests(unittest.TestCase):
    def test_valid_task_passes(self):
        self.assertEqual(run_task.validate_task(fixture("task.json")), [])

    def test_missing_fields_and_bad_e164_rejected(self):
        task = fixture("task.json")
        del task["callee"]
        task["goal"] = "x"
        problems = run_task.validate_task(task)
        self.assertTrue(any("callee" in p for p in problems))
        task = fixture("task.json")
        task["callee"] = "0033123456789"
        self.assertTrue(any("E.164" in p for p in run_task.validate_task(task)))
        task = fixture("task.json")
        task["callee"] = "＋12025550123"
        self.assertTrue(any("ASCII" in p for p in run_task.validate_task(task)))


class MaskingTests(unittest.TestCase):
    def test_masks_every_spelling_of_callee(self):
        task = fixture("task.json")
        targets = run_task.callee_variants(task["callee"])
        payload = {
            "callee": task["callee"],
            "digits": "12025550123",
            "spaced": "1 2 0 2 5 5 5 0 1 2 3",
            "nanp": "(202) 555-0123",
            "note": "call +1 202-555-0123 back",
        }
        masked = run_task.mask_sensitive(payload, targets)
        self.assertNotIn("12025550123", json.dumps(masked))
        self.assertNotIn("2025550123", json.dumps(masked))
        self.assertNotIn("202 555 0123", json.dumps(masked))

    def test_mask_number_keeps_last_four(self):
        self.assertEqual(run_task.mask_number("+12025550123"), "+1******0123")


class ObservationProposalTests(unittest.TestCase):
    def test_multi_menu_fixture_does_not_crash(self):
        final = fixture("call-success.json")
        proposal = run_task.propose_observation(final)
        joined = " | ".join(proposal["menu_options_observed"])
        self.assertIn("press 1", joined)
        self.assertIn("prescription status", joined)
        self.assertEqual(proposal["keys_reported_pressed"], ["1"])
        self.assertEqual(proposal["keypress_claim"], "reported")

    def test_no_keypress_fixture_reports_no_keys(self):
        final = fixture("call-no-keypress.json")
        proposal = run_task.propose_observation(final)
        self.assertEqual(proposal["keys_reported_pressed"], [])
        self.assertEqual(proposal["keypress_claim"], "none")
        joined = " | ".join(proposal["menu_options_observed"])
        self.assertIn("press 1", joined)

    def test_menu_options_never_count_as_pressed_keys(self):
        final = fixture("call-no-keypress.json")
        proposal = run_task.propose_observation(final)
        for key in proposal["keys_reported_pressed"]:
            self.assertNotIn(f"press {key}:", " | ".join(proposal["menu_options_observed"]))


class VerifyResultTests(unittest.TestCase):
    def verify(self, name: str):
        proc = subprocess.run(
            [sys.executable, str(VERIFY), "--result", str(FIXTURES / name)],
            capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def test_success_fixture_verifies_field_by_field(self):
        report = self.verify("call-success.json")
        self.assertEqual(report["overall"], "partially verified")
        self.assertEqual(report["fields"]["refill_status"]["verdict"], "verified")
        self.assertEqual(report["fields"]["pickup_by"]["verdict"], "verified")
        self.assertEqual(report["fields"]["ready_today"]["verdict"], "unverified")

    def test_contradicted_fixture_flags_wrong_value(self):
        report = self.verify("call-contradicted.json")
        self.assertEqual(report["overall"], "contradicted")
        self.assertEqual(report["fields"]["tomorrow_high_f"]["verdict"], "contradicted")
        self.assertEqual(report["fields"]["tomorrow_forecast"]["verdict"], "verified")

    def test_range_speech_verifies_numeric_fields(self):
        case = {
            "structured_result": {"tomorrow_high_f": 85},
            "transcript": "USER: Tomorrow. Highs in the mid 80s. Lows in the lower 60s.",
        }
        verdict, _ = verify_result.verdict_for("tomorrow_high_f", 85, case["transcript"])
        self.assertEqual(verdict, "verified")

    def test_numeric_field_without_name_in_transcript_stays_unverified(self):
        case = {
            "structured_result": {"tomorrow_high_f": 85},
            "transcript": "USER: The observation deck is 85 feet tall.",
        }
        verdict, _ = verify_result.verdict_for("tomorrow_high_f", 85, case["transcript"])
        self.assertEqual(verdict, "unverified")


class RunnerGateTests(unittest.TestCase):
    def run_runner(self, args, env, stdin=subprocess.DEVNULL):
        return subprocess.run(
            [sys.executable, str(RUN_TASK), *args],
            capture_output=True, text=True, env=env, stdin=stdin, timeout=60,
        )

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="holdfast-test-"))
        self.task = self.tmp / "task.json"
        self.task.write_text(json.dumps(fixture("task.json")), encoding="utf-8")

    def out(self, name: str) -> Path:
        path = self.tmp / name
        path.mkdir()
        return path

    def test_dry_run_places_zero_calls_and_masks_artifacts(self):
        fake = FakeCalle(self.tmp, {})
        out = self.out("dry")
        proc = self.run_runner(["--task", str(self.task), "--out", str(out)], fake.env())
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("plan preview", proc.stdout)
        self.assertEqual(fake.invocation_count(), 0)
        for name in ("task.json", "instructions.txt"):
            stored = (out / name).read_text(encoding="utf-8")
            self.assertNotIn("12025550123", stored.replace("*", ""))
        self.assertFalse((out / "consent.json").exists())

    def test_run_without_confirmation_dials_zero_times(self):
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "X"})
        out = self.out("noconfirm")
        proc = self.run_runner(
            ["--task", str(self.task), "--run", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0)
        consent = json.loads((out / "consent.json").read_text(encoding="utf-8"))
        self.assertFalse(consent["confirmed"])

    def test_run_with_yes_dials_once_and_fails_closed_on_balance(self):
        fake = FakeCalle(self.tmp, fixture("call-balance-failure.json"))
        out = self.out("balance")
        proc = self.run_runner(
            ["--task", str(self.task), "--run", "--yes", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 1)
        self.assertTrue(fake.saw("call start"))
        ledger = json.loads((out / "pending.json").read_text(encoding="utf-8"))
        self.assertEqual(ledger["state"], "never_started")
        self.assertFalse((out / "final.json").exists())

    def test_in_flight_ledger_blocks_redial_and_resume_recovers(self):
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "X"})
        out = self.out("interrupted")
        (out / "pending.json").write_text(
            json.dumps({"state": "in_flight", "run_id": "RUN-1"}), encoding="utf-8"
        )
        proc = self.run_runner(
            ["--task", str(self.task), "--run", "--yes", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0, "a second call must never be placed")

        proc = self.run_runner(
            ["--task", str(self.task), "--run", "--resume", "--out", str(out)], fake.env()
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(fake.saw("call start"), "resume must not dial")
        self.assertTrue(fake.saw("call status --run-id RUN-1"))
        self.assertTrue((out / "final.json").exists())
        ledger = json.loads((out / "pending.json").read_text(encoding="utf-8"))
        self.assertEqual(ledger["state"], "finished")

    def test_resume_without_run_id_refuses_to_redial(self):
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "X"})
        out = self.out("lost")
        (out / "pending.json").write_text(json.dumps({"state": "dialing"}), encoding="utf-8")
        proc = self.run_runner(
            ["--task", str(self.task), "--run", "--resume", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0)
        self.assertIn("calle call recover", proc.stderr)


class MapUpdateTests(unittest.TestCase):
    def test_disallowed_observation_keys_rejected(self):
        proc = subprocess.run(
            [sys.executable, str(MAP_UPDATE), "--company", "example-org", "--observation", "-"],
            input=json.dumps({"caller_name": "Alex", "ssn": "123"}),
            capture_output=True, text=True,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("disallowed keys", proc.stderr)


class RepoRootCommandTests(unittest.TestCase):
    """The commands quoted to judges must work verbatim from the repo root."""

    def test_dry_run_from_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "run"
            proc = subprocess.run(
                [
                    sys.executable, "skills/holdfast/scripts/run_task.py",
                    "--task", "skills/holdfast/tests/fixtures/task.json",
                    "--out", str(out),
                ],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("HoldFast plan preview", proc.stdout)
            self.assertTrue((out / "task.json").exists())

    def test_verify_from_repo_root(self):
        proc = subprocess.run(
            [
                sys.executable, "skills/holdfast/scripts/verify_result.py",
                "--result", "skills/holdfast/tests/fixtures/call-success.json",
            ],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["overall"], "partially verified")


if __name__ == "__main__":
    unittest.main()
