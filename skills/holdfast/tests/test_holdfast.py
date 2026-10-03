"""HoldFast offline acceptance tests.

Every test runs without CALL-E credentials and without network access. Tests
that exercise the real-call path install a fake `calle` executable earlier in
PATH and assert on its invocation log, so a regression that dials for real
fails here instead of on a live account. The global dialing ledger is
redirected to a per-test temp file via HOLDFAST_LEDGER.
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
from datetime import date, datetime, timedelta, timezone
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
    """A fake `calle` CLI that logs every invocation and replays canned JSON
    per subcommand (start/status)."""

    def __init__(self, tmp: Path, start_response: dict, status_response: dict | None = None):
        self.tmp = tmp
        self.bin = tmp / "bin"
        self.bin.mkdir(exist_ok=True)
        self.log = tmp / "calle.log"
        start_file = tmp / "start-response.json"
        start_file.write_text(json.dumps(start_response), encoding="utf-8")
        status_file = tmp / "status-response.json"
        status_file.write_text(json.dumps(status_response or {"ok": True, "status": "COMPLETED"}), encoding="utf-8")
        script = self.bin / "calle"
        script.write_text(
            "#!/bin/sh\n"
            f"echo \"invoked: $1 $2 $3 $4\" >> {self.log}\n"
            f"if [ \"$1 $2\" = 'call start' ]; then cat {start_file}; "
            f"elif [ \"$1 $2\" = 'call status' ]; then cat {status_file}; "
            "else echo '{\"ok\": false, \"error\": \"unknown command\"}'; fi\n",
            encoding="utf-8",
        )
        script.chmod(script.stat().st_mode | stat.S_IEXEC)

    def env(self):
        env = dict(os.environ)
        env["PATH"] = f"{self.bin}{os.pathsep}{env['PATH']}"
        env["HOLDFAST_LEDGER"] = str(self.tmp / "ledger.json")
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


class LedgeredTestCase(unittest.TestCase):
    """Isolate the global dialing ledger to a temp file per test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="holdfast-test-")
        self.tmp = Path(self._tmp.name)
        self.task_file = self.tmp / "task.json"
        self.task_file.write_text(json.dumps(fixture("task.json")), encoding="utf-8")
        self._old_ledger = os.environ.get("HOLDFAST_LEDGER")
        os.environ["HOLDFAST_LEDGER"] = str(self.tmp / "ledger.json")

    def tearDown(self):
        if self._old_ledger is None:
            os.environ.pop("HOLDFAST_LEDGER", None)
        else:
            os.environ["HOLDFAST_LEDGER"] = self._old_ledger
        self._tmp.cleanup()

    def out(self, name: str) -> Path:
        path = self.tmp / name
        path.mkdir()
        return path

    def run_runner(self, args, env=None, stdin=subprocess.DEVNULL):
        merged = dict(os.environ)
        if env:
            merged.update(env)
        return subprocess.run(
            [sys.executable, str(RUN_TASK), *args],
            capture_output=True, text=True, env=merged, stdin=stdin, timeout=90,
        )


class ValidateTaskTests(LedgeredTestCase):
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

    def test_e164_rejects_trailing_whitespace(self):
        base = fixture("task.json")
        for bad in ("+12025550123\n", "+12025550123 ", "  +12025550123", "+1202555١٢٣", "2025550123"):
            with self.subTest(bad=bad):
                problems = run_task.validate_task({**base, "callee": bad})
                self.assertTrue(problems, f"{bad!r} must be rejected")


class MaskingTests(LedgeredTestCase):
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

    def test_masks_phone_numbers_in_keys_and_numeric_values(self):
        payload = {
            "+12025550123": "destination key",
            "numeric_destination": 12025550123,
        }
        rendered = json.dumps(run_task.mask_sensitive(payload, []))
        self.assertNotIn("12025550123", rendered)


class RouteTrustTests(LedgeredTestCase):
    def test_only_exact_fresh_human_reviewed_route_is_consumed(self):
        task = fixture("judge-parts-task.json")
        today = datetime.now(timezone.utc).date()
        stale = {
            "goal": task["goal"],
            "path": [{"keypress": "9", "meaning": "stale route"}],
            "confidence": "observed",
            "human_reviewed": True,
            "last_observed": (today - timedelta(days=31)).isoformat(),
        }
        wrong_goal = {
            "goal": "Place a new parts order",
            "path": [{"keypress": "8", "meaning": "sales"}],
            "confidence": "observed",
            "human_reviewed": True,
            "last_observed": today.isoformat(),
        }
        unreviewed = {
            "goal": task["goal"],
            "path": [{"keypress": "7", "meaning": "unreviewed route"}],
            "confidence": "observed",
            "human_reviewed": False,
            "last_observed": today.isoformat(),
        }
        trusted = {
            "goal": task["goal"],
            "path": [{"keypress": "1", "meaning": "existing order status"}],
            "confidence": "observed",
            "human_reviewed": True,
            "observations": 2,
            "last_observed": today.isoformat(),
        }
        map_info = {
            "found": True,
            "organization": "example-parts-distributor",
            "known_paths": [stale, wrong_goal, unreviewed, trusted],
        }
        selected, _ = run_task.reusable_route(task, map_info, today=today)
        self.assertEqual(selected, trusted)
        rendered = run_task.render_instructions(task, map_info)
        self.assertIn("press 1 for existing order status", rendered)
        self.assertNotIn("press 9", rendered)
        self.assertNotIn("press 7", rendered)

        selected, reason = run_task.reusable_route(
            task, {**map_info, "known_paths": [stale, wrong_goal, unreviewed]}, today=today
        )
        self.assertIsNone(selected)
        self.assertIn("no exact-goal, fresh, human-reviewed route", reason)


class ObservationProposalTests(LedgeredTestCase):
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


class VerifyResultTests(LedgeredTestCase):
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
        # "held until September 18" never states a year, and the expected
        # value carries one: supportive but not conclusive.
        self.assertEqual(report["fields"]["pickup_by"]["verdict"], "plausible")
        self.assertEqual(report["fields"]["ready_today"]["verdict"], "unverified")
        for name in ("refill_status",):
            self.assertIn("speaker", report["fields"][name])
            self.assertIn("span", report["fields"][name])

    def test_contradicted_fixture_flags_wrong_value(self):
        report = self.verify("call-contradicted.json")
        self.assertEqual(report["overall"], "contradicted")
        self.assertEqual(report["fields"]["tomorrow_high_f"]["verdict"], "contradicted")
        self.assertEqual(report["fields"]["tomorrow_forecast"]["verdict"], "verified")

    def test_provider_failure_caps_overall_at_unverified(self):
        case = {
            "ok": False,
            "status": "FAILED",
            "structured_result": {"refill_status": "ready"},
            "transcript": "USER: Your prescription is ready for pickup today.",
        }
        proc = subprocess.run(
            [sys.executable, str(VERIFY), "--result", "-"],
            input=json.dumps(case), capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["overall"], "unverified")

    def test_provider_lifecycle_uses_only_authoritative_envelopes(self):
        metadata_only = {"ok": True, "metadata": {"status": "COMPLETED"}}
        self.assertIn("authoritative", verify_result.provider_blocks_verification(metadata_only))

        conflict = {
            "ok": True,
            "status": "IN_PROGRESS",
            "result": {"status": "COMPLETED"},
        }
        self.assertIn("not COMPLETED", verify_result.provider_blocks_verification(conflict))

        completed_with_domain_status = {
            "ok": True,
            "status": "COMPLETED",
            "result": {"status": "FAILED"},
        }
        self.assertIsNone(verify_result.provider_blocks_verification(completed_with_domain_status))


class AdversarialVerifierTests(LedgeredTestCase):
    """Each sample must NOT come back verified; several have a definite
    honest verdict (contradicted/unverified) which we assert exactly."""

    def verdict(self, field: str, value, transcript: str) -> str:
        result = verify_result.verdict_for(field, value, transcript)
        return result["verdict"]

    def test_negation_is_not_evidence(self):
        v = self.verdict("refill_status", "ready", "USER: I'm sorry, your refill is not ready yet.")
        self.assertNotEqual(v, "verified")
        self.assertEqual(v, "contradicted")

    def test_adjacent_field_number_does_not_verify(self):
        transcript = "USER: Friday. Highs in the mid 80s. Lows near 60."
        self.assertEqual(self.verdict("tomorrow_high_f", 60, transcript), "contradicted")
        # "Lows near 60" is approximate ("near") and never says tomorrow:
        # supportive at best, never verified.
        self.assertNotEqual(self.verdict("tomorrow_low_f", 60, transcript), "verified")

    def test_assistant_self_report_is_not_evidence(self):
        v = self.verdict(
            "refill_status", "ready",
            "BOT: I checked and the refill status is ready.\nUSER: Thank you for calling.",
        )
        self.assertNotEqual(v, "verified")

    def test_alphanumeric_reference_never_reduces_to_digits(self):
        v = self.verdict(
            "claim_reference", "AB12CD3",
            "USER: The timestamp is 12 03 4 7 at the depot.",
        )
        self.assertNotEqual(v, "verified")

    def test_wrong_daypart_is_not_evidence(self):
        v = self.verdict("tomorrow_high_f", 85, "USER: Today's high was 85. Tomorrow should be cooler.")
        self.assertNotEqual(v, "verified")

    def test_timestamp_digits_do_not_verify_numeric_field(self):
        v = self.verdict(
            "claim_balance_usd", 8500,
            "USER: Your reference was logged at 8500 hours.",
        )
        self.assertNotEqual(v, "verified")

    def test_value_only_in_assistant_turn_with_menu_phrasing(self):
        v = self.verdict(
            "menu_choice", "2",
            "BOT: I heard press 2 for claims, so I pressed 2.\nUSER: Thank you for calling.",
        )
        self.assertNotEqual(v, "verified")

    def test_negated_range_is_not_verified(self):
        v = self.verdict(
            "tomorrow_high_f", 85,
            "USER: Tomorrow. Highs not expected to reach the mid 80s.",
        )
        self.assertNotEqual(v, "verified")


class RunnerGateTests(LedgeredTestCase):
    def test_dry_run_places_zero_calls_and_masks_artifacts(self):
        fake = FakeCalle(self.tmp, {})
        out = self.out("dry")
        proc = self.run_runner(["--task", str(self.task_file), "--out", str(out)], fake.env())
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("plan preview", proc.stdout)
        self.assertEqual(fake.invocation_count(), 0)
        for name in ("task.json", "instructions.txt", "preview.txt"):
            stored = (out / name).read_text(encoding="utf-8")
            self.assertNotIn("12025550123", stored.replace("*", ""))
        self.assertFalse((out / "consent.json").exists())

    def test_run_without_confirmation_dials_zero_times(self):
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "X"})
        out = self.out("noconfirm")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0)
        consent = json.loads((out / "consent.json").read_text(encoding="utf-8"))
        self.assertFalse(consent["confirmed"])

    def test_run_with_yes_dials_once_and_fails_closed_on_balance(self):
        fake = FakeCalle(self.tmp, fixture("call-balance-failure.json"))
        out = self.out("balance")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 1)
        self.assertTrue(fake.saw("call start"))
        entry = run_task.ledger_entry(run_task._task_fingerprint(fixture("task.json")))
        self.assertEqual(entry["state"], "never_started")
        self.assertFalse((out / "final.json").exists())

    def test_finished_task_blocks_redial_across_directories_until_retry(self):
        start = {"ok": True, "call_started": True, "run_id": "RUN-FIN"}
        final = {
            "ok": True, "status": "COMPLETED",
            "result": {"summary": "done", "transcript": "USER: done"},
        }
        fake = FakeCalle(self.tmp, start, final)
        out1 = self.out("first")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out1)], fake.env()
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(fake.saw("call start"))
        calls_after_first = fake.invocation_count()

        out2 = self.out("second")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out2)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), calls_after_first, "same task must not dial twice")

        out3 = self.out("retry")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--retry", "--out", str(out3)], fake.env()
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(fake.invocation_count(), calls_after_first + 2, "--retry adds exactly one start and one poll")

    def test_in_flight_entry_blocks_redial_and_resume_recovers(self):
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "RUN-1"})
        fingerprint = run_task._task_fingerprint(fixture("task.json"))
        run_task.write_ledger_entry(
            fingerprint,
            state="in_flight",
            run_id="RUN-1",
            callee_digits_sha256=run_task._callee_fingerprint(fixture("task.json")["callee"]),
        )
        out = self.out("blocked")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0, "a second call must never be placed")

        out2 = self.out("resumed")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--resume", "--out", str(out2)], fake.env()
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(fake.saw("call start"), "resume must not dial")
        self.assertTrue(fake.saw("call status --run-id RUN-1"))
        self.assertTrue((out2 / "final.json").exists())
        entry = run_task.ledger_entry(fingerprint)
        self.assertEqual(entry["state"], "finished")

    def test_resume_rejects_a_different_task(self):
        fingerprint = run_task._task_fingerprint(fixture("task.json"))
        run_task.write_ledger_entry(fingerprint, state="in_flight", run_id="RUN-1")
        other = dict(fixture("task.json"))
        other["goal"] = "A different errand entirely."
        other_file = self.tmp / "other-task.json"
        other_file.write_text(json.dumps(other), encoding="utf-8")
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "RUN-1"})
        out = self.out("wrongtask")
        proc = self.run_runner(
            ["--task", str(other_file), "--run", "--resume", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0)

    def test_resume_without_run_id_refuses_to_redial(self):
        fingerprint = run_task._task_fingerprint(fixture("task.json"))
        run_task.write_ledger_entry(fingerprint, state="dialing")
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "X"})
        out = self.out("lost")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--resume", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0)
        self.assertIn("calle call recover", proc.stderr)

    def test_destination_mismatch_marks_uncertain_and_blocks_redial(self):
        start = {"ok": True, "call_started": True, "run_id": "RUN-MIS", "to_phone": "+12025550124"}
        fake = FakeCalle(self.tmp, start)
        out = self.out("mismatch")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        entry = run_task.ledger_entry(run_task._task_fingerprint(fixture("task.json")))
        self.assertEqual(entry["state"], "uncertain")
        calls = fake.invocation_count()
        out2 = self.out("mismatch2")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out2)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), calls, "uncertain calls must not be redialed")


class RunnerIntegrityTests(LedgeredTestCase):
    """Adversarial probes for exactly-once, fail-closed state, and privacy."""

    def test_concurrent_confirmed_runs_dial_exactly_once(self):
        import threading
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "RUN-RACE"})
        results = []

        def launch(out_name):
            out = self.tmp / out_name
            out.mkdir()
            results.append(
                self.run_runner(
                    ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)],
                    fake.env(),
                )
            )

        threads = [threading.Thread(target=launch, args=(f"race{i}",)) for i in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        starts = sum(
            1 for line in fake.log.read_text(encoding="utf-8").splitlines()
            if line.startswith("invoked: call start")
        ) if fake.log.exists() else 0
        self.assertEqual(starts, 1, "two concurrently confirmed runs must produce one provider start")
        self.assertEqual(
            sorted(proc.returncode for proc in results), [0, 1],
            "one run wins the reservation, the other backs off",
        )

    def test_corrupt_ledger_fails_closed_without_dialing(self):
        ledger = self.tmp / "ledger.json"
        ledger.write_text("{not json", encoding="utf-8")
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "X"})
        out = self.out("corrupt")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)],
            fake.env(),
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0, "a corrupt ledger must never reach the provider")
        self.assertEqual(ledger.read_text(encoding="utf-8"), "{not json", "corrupt ledger must not be overwritten")

    def test_list_ledger_fails_closed_with_a_controlled_error(self):
        ledger = self.tmp / "ledger.json"
        ledger.write_text("[]", encoding="utf-8")
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "X"})
        out = self.out("list-ledger")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)],
            fake.env(),
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(fake.invocation_count(), 0)
        self.assertIn("expected a JSON object", proc.stderr)
        self.assertNotIn("Traceback", proc.stderr)
        self.assertEqual(ledger.read_text(encoding="utf-8"), "[]")

    def test_provider_start_response_matrix(self):
        callee = fixture("task.json")["callee"]
        matrix = [
            # (start response, expected state, may_dial_again_without_retry)
            ({"ok": False, "call_started": True, "run_id": "R-OKF", "to_phone": callee}, "finished", False),
            ({"call_started": True, "run_id": "R-NOOK", "to_phone": callee}, "finished", False),
            ({"ok": True, "run_id": "R-NOFLAG"}, "uncertain", False),
            ({"ok": True, "call_started": False}, "never_started", True),
            ({"ok": False, "call_started": False, "run_id": "R-CONFLICT"}, "uncertain", False),
            ({
                "ok": True,
                "call_started": True,
                "run_id": "R-OUTER",
                "result": {"run_id": "R-INNER"},
            }, "uncertain", False),
            ({"ok": True, "call_started": True, "run_id": "R-AMB", "to_phones": [callee, "+13034944221"]}, "uncertain", False),
        ]
        for start, expected_state, may_redial in matrix:
            with self.subTest(start=start):
                sub = self.tmp / f"matrix-{expected_state}-{start.get('run_id', 'x')}"
                sub.mkdir()
                fake = FakeCalle(sub, start)
                out = sub / "out"
                out.mkdir()
                env = fake.env()
                # read the same ledger file the runner subprocess will use
                os.environ["HOLDFAST_LEDGER"] = env["HOLDFAST_LEDGER"]
                proc = self.run_runner(
                    ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)], env
                )
                entry = run_task.ledger_entry(run_task._task_fingerprint(fixture("task.json")))
                self.assertEqual(entry["state"], expected_state)
                if expected_state == "finished":
                    self.assertEqual(proc.returncode, 0, proc.stderr)
                    self.assertEqual(entry.get("run_id"), start.get("run_id"))
                else:
                    self.assertNotEqual(proc.returncode, 0)
                calls_after_first = fake.invocation_count()
                out2 = sub / "out2"
                out2.mkdir()
                proc = self.run_runner(
                    ["--task", str(self.task_file), "--run", "--yes", "--out", str(out2)], env
                )
                if may_redial:
                    # never_started means the provider asserts no call was
                    # placed, so a fresh confirmed attempt may dial again
                    # (the repeated rejection still fails the run itself).
                    self.assertGreater(fake.invocation_count(), calls_after_first)
                else:
                    self.assertNotEqual(proc.returncode, 0)
                    self.assertEqual(
                        fake.invocation_count(), calls_after_first,
                        f"state {expected_state} must block a redial",
                    )

    def test_fingerprint_ignores_criteria_order(self):
        task = fixture("task.json")
        reordered = dict(task)
        reordered["success_criteria"] = list(reversed(task["success_criteria"]))
        self.assertEqual(
            run_task._task_fingerprint(task), run_task._task_fingerprint(reordered),
            "re-ordering the same intent must not mint a new identity",
        )

    def test_resume_validates_binding_before_writing_artifacts(self):
        fingerprint = run_task._task_fingerprint(fixture("task.json"))
        run_task.write_ledger_entry(fingerprint, state="in_flight", run_id="RUN-X")
        other = dict(fixture("task.json"))
        other["goal"] = "A different errand entirely."
        other_file = self.tmp / "other-task.json"
        other_file.write_text(json.dumps(other), encoding="utf-8")
        fake = FakeCalle(self.tmp, {"ok": True, "call_started": True, "run_id": "RUN-X"})
        out = self.out("resume-binding")
        proc = self.run_runner(
            ["--task", str(other_file), "--run", "--resume", "--out", str(out)], fake.env()
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse((out / "task.json").exists(), "a failed resume must not write plan artifacts")

    def test_forbidden_secret_keys_fail_before_any_artifact(self):
        for index, key in enumerate((
            "api_token", "apiToken", "cardNumber", "userPassword", "securityPin",
        )):
            with self.subTest(key=key):
                task = fixture("task.json")
                task["context"] = dict(task["context"], **{key: "never-store-this"})
                secret_file = self.tmp / f"secret-task-{index}.json"
                secret_file.write_text(json.dumps(task), encoding="utf-8")
                provider_dir = self.tmp / f"secret-provider-{index}"
                provider_dir.mkdir()
                fake = FakeCalle(provider_dir, {
                    "ok": True, "call_started": True, "run_id": "X",
                })
                out = self.out(f"secrets-{index}")
                proc = self.run_runner(
                    ["--task", str(secret_file), "--out", str(out)], fake.env()
                )
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(fake.invocation_count(), 0)
                self.assertIn("forbidden key", proc.stderr)
                self.assertFalse((out / "task.json").exists(), "forbidden input must not reach artifacts")

    def test_resume_masks_short_e164_in_final_artifact(self):
        task = fixture("task.json")
        task["callee"] = "+1234567"
        task_file = self.tmp / "short-task.json"
        task_file.write_text(json.dumps(task), encoding="utf-8")
        status = {
            "ok": True, "status": "COMPLETED",
            "to_phone": "+1234567",
            "summary": "The line for +1234567 answered with a recorded message.",
        }
        sub = self.tmp / "short"
        sub.mkdir()
        fake = FakeCalle(sub, {}, status)
        os.environ["HOLDFAST_LEDGER"] = fake.env()["HOLDFAST_LEDGER"]
        fingerprint = run_task._task_fingerprint(task)
        run_task.write_ledger_entry(
            fingerprint,
            state="in_flight",
            run_id="RUN-SHORT",
            callee_digits_sha256=run_task._callee_fingerprint(task["callee"]),
        )
        out = sub / "out"
        out.mkdir()
        proc = self.run_runner(
            ["--task", str(task_file), "--run", "--resume", "--out", str(out)], fake.env()
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        final_text = (out / "final.json").read_text(encoding="utf-8")
        self.assertNotIn("+1234567", final_text)
        self.assertNotIn("1234567", proc.stdout)


class EvidenceChainTests(LedgeredTestCase):
    """One task through the whole safe path with a single provider start."""

    def test_chain_task_to_map_proposal(self):
        judge_task = fixture("judge-parts-task.json")
        self.task_file.write_text(json.dumps(judge_task), encoding="utf-8")
        start = {"ok": True, "call_started": True, "run_id": "CHAIN-1", "to_phone": judge_task["callee"]}
        status = fixture("judge-parts-result.json")
        status["ok"] = True
        status["status"] = "COMPLETED"
        status["structuredContent"]["run_id"] = "CHAIN-1"
        fake = FakeCalle(self.tmp, start, status)
        out = self.out("chain")
        proc = self.run_runner(
            ["--task", str(self.task_file), "--run", "--yes", "--out", str(out)], fake.env()
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(fake.invocation_count(), 2, "exactly one start and one status poll")

        task = json.loads((out / "task.json").read_text(encoding="utf-8"))
        self.assertNotIn("12025550123", json.dumps(task))
        fingerprint = run_task._task_fingerprint(judge_task)
        local = json.loads((out / "pending.json").read_text(encoding="utf-8"))
        self.assertEqual(local["task_fingerprint"], fingerprint)
        self.assertEqual(local["run_id"], "CHAIN-1")
        global_entry = run_task.ledger_entry(fingerprint)
        self.assertEqual(global_entry["run_id"], "CHAIN-1")

        start_saved = json.loads((out / "start.json").read_text(encoding="utf-8"))
        final_saved = json.loads((out / "final.json").read_text(encoding="utf-8"))
        self.assertEqual(run_task.find_key(start_saved, "run_id"), "CHAIN-1")
        self.assertEqual(run_task.find_key(final_saved, "run_id"), "CHAIN-1")

        verification = json.loads((out / "verification.json").read_text(encoding="utf-8"))
        self.assertIn(verification["overall"], ("verified", "partially verified"))
        verified_fields = {
            name: f for name, f in verification["fields"].items()
            if f["verdict"] == "verified"
        }
        self.assertTrue(verified_fields)
        for field in verified_fields.values():
            self.assertEqual(field["speaker"], "callee")
            self.assertTrue(field["span"])

        proposal = json.loads((out / "observation-proposal.json").read_text(encoding="utf-8"))
        self.assertIn("press 1", " | ".join(proposal["menu_options_observed"]))
        self.assertEqual(proposal["keys_reported_pressed"], ["1"])
        packet = (out / "result-packet.txt").read_text(encoding="utf-8")
        self.assertIn("[PROVEN] shipping_status: shipped", packet)
        self.assertIn("[NOT PROVEN] tracking_number: ZX-9081", packet)


class MapUpdateTests(LedgeredTestCase):
    def test_disallowed_observation_keys_rejected(self):
        proc = subprocess.run(
            [sys.executable, str(MAP_UPDATE), "--company", "example-org", "--observation", "-"],
            input=json.dumps({"caller_name": "Alex", "ssn": "123"}),
            capture_output=True, text=True,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("disallowed keys", proc.stderr)

    def test_observed_route_starts_unreviewed(self):
        maps = self.tmp / "maps"
        observation = {
            "goal": fixture("judge-parts-task.json")["goal"],
            "observed_path": [
                {"prompt_summary": "orders menu", "keypress": "1", "meaning": "existing order"}
            ],
            "date": date.today().isoformat(),
        }
        proc = subprocess.run(
            [
                sys.executable, str(MAP_UPDATE),
                "--company", "example-parts-distributor",
                "--observation", "-",
                "--maps-dir", str(maps),
            ],
            input=json.dumps(observation), capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        saved = json.loads((maps / "example-parts-distributor.json").read_text(encoding="utf-8"))
        self.assertIs(saved["known_paths"][0]["human_reviewed"], False)


class RepoRootCommandTests(LedgeredTestCase):
    """The commands quoted to judges must work verbatim from the repo root."""

    def test_dry_run_from_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "run"
            env = dict(os.environ)
            env["HOLDFAST_LEDGER"] = str(Path(tmp) / "ledger.json")
            proc = subprocess.run(
                [
                    sys.executable, "skills/holdfast/scripts/run_task.py",
                    "--task", "skills/holdfast/tests/fixtures/task.json",
                    "--out", str(out),
                ],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=60, env=env,
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

    def test_judge_result_packet_from_repo_root(self):
        proc = subprocess.run(
            [
                sys.executable, "skills/holdfast/scripts/run_task.py",
                "--task", "skills/holdfast/tests/fixtures/judge-parts-task.json",
                "--inspect-result", "skills/holdfast/tests/fixtures/judge-parts-result.json",
            ],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("HOLDFAST RESULT PACKET", proc.stdout)
        self.assertIn("CALL COMPLETED", proc.stdout.upper())
        self.assertIn("[PROVEN] shipping_status: shipped", proc.stdout)
        self.assertIn("[PROVEN] estimated_arrival: Tuesday", proc.stdout)
        self.assertIn("[NOT PROVEN] tracking_number: ZX-9081", proc.stdout)
        self.assertIn("transcript evidence decides what is usable", proc.stdout.lower())
        self.assertNotIn("12025550123", proc.stdout)


if __name__ == "__main__":
    unittest.main()
