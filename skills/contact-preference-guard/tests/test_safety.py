"""Behavioral boundaries of the validator/adapter, not language-accuracy tests."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "demo"))
from validate import read_json, score, validate
from dry_run import preview


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.cases = {c["id"]: c for c in read_json(ROOT / "examples/demo-cases.json")["cases"]}
        self.crm = read_json(ROOT / "demo/mock_crm.json")

    def test_temporary_dnc_retains_bound_and_never_sets_global(self):
        case = self.cases["today-only"]
        after, review = preview(case["input"], case["proposal"], self.crm)
        self.assertFalse(review)
        self.assertFalse(after["global_do_not_call"])
        self.assertEqual(after["task_suppressions"][0]["time_bound"], case["proposal"]["preferences"][0]["time_bound"])
        self.assertEqual(after["task_suppressions"][0]["task"], case["input"]["call_context"]["task"])

    def test_task_dnc_does_not_become_organization_dnc(self):
        case = self.cases["order-only"]
        after, _ = preview(case["input"], case["proposal"], self.crm)
        self.assertFalse(after["global_do_not_call"])
        self.assertEqual(after["task_suppressions"][0]["scope"], "this_task")

    def test_repeat_is_idempotent(self):
        case = self.cases["today-only"]
        after, _ = preview(case["input"], case["proposal"], self.crm)
        again, _ = preview(case["input"], case["proposal"], after)
        self.assertEqual(after, again)

    def test_wrong_organization_cannot_change_mock(self):
        case = copy.deepcopy(self.cases["ongoing-window"])
        case["input"]["call_context"]["organization"] = "Another Company"
        with self.assertRaises(ValueError):
            preview(case["input"], case["proposal"], self.crm)

    def test_review_blocks_entire_mixed_batch(self):
        case = copy.deepcopy(self.cases["complaint"])
        other = self.cases["ongoing-window"]
        case["input"]["transcript"] += other["input"]["transcript"]
        case["proposal"]["preferences"] += other["proposal"]["preferences"]
        after, review = preview(case["input"], case["proposal"], self.crm)
        self.assertEqual(after, self.crm)
        self.assertTrue(review)

    def global_dnc_case(self):
        case = read_json(ROOT / "tests/semantic-approval-cases.json")["cases"][0]
        proposal = copy.deepcopy(case["expected"])
        proposal["preferences"][0].update(evidence=case["input"]["transcript"], confidence="high")
        return {"input": case["input"], "proposal": proposal}

    def test_explicit_global_dnc_needs_no_semantic_clarification(self):
        case = self.global_dnc_case()
        self.assertEqual(validate(case["input"], case["proposal"]), [])
        after, review = preview(case["input"], case["proposal"], self.crm)
        self.assertFalse(review)
        self.assertTrue(after["global_do_not_call"])
        self.assertFalse(self.crm["global_do_not_call"])
        self.assertFalse(case["proposal"]["preferences"][0]["requires_human_review"])

    def test_ambiguity_blocks_even_explicit_global_dnc_in_mixed_batch(self):
        case = self.global_dnc_case()
        complaint = self.cases["complaint"]
        case["input"]["transcript"] += complaint["input"]["transcript"]
        case["proposal"]["preferences"] += complaint["proposal"]["preferences"]
        case["proposal"]["status"] = "review_required"
        after, review = preview(case["input"], case["proposal"], self.crm)
        self.assertTrue(review)
        self.assertEqual(after, self.crm)

    def test_explicit_withdrawal_is_not_uncertain_but_adapter_cannot_clear_dnc(self):
        case = self.global_dnc_case()
        case["input"]["transcript"] = "Remove the ongoing company-wide do-not-call restriction."
        case["proposal"]["preferences"][0].update(value=False, evidence=case["input"]["transcript"])
        self.assertEqual(validate(case["input"], case["proposal"]), [])
        with self.assertRaisesRegex(ValueError, "Clearing DNC is unsupported"):
            preview(case["input"], case["proposal"], self.crm)

    def test_consent_fields_rejected(self):
        case = copy.deepcopy(self.cases["ongoing-window"])
        case["proposal"]["preferences"][0]["marketing_sms_consent"] = True
        with self.assertRaises(ValueError):
            preview(case["input"], case["proposal"], self.crm)

    def test_missing_temporary_bound_rejected(self):
        case = copy.deepcopy(self.cases["today-only"])
        del case["proposal"]["preferences"][0]["time_bound"]
        self.assertTrue(validate(case["input"], case["proposal"]))

    def test_agent_speech_cannot_supply_evidence(self):
        case = copy.deepcopy(self.cases["ongoing-window"])
        case["input"]["transcript"] = [{"speaker": "agent", "text": case["input"]["transcript"]},
                                         {"speaker": "recipient", "text": "I did not request that."}]
        self.assertTrue(validate(case["input"], case["proposal"]))

    def test_fabricated_evidence_rejected(self):
        case = copy.deepcopy(self.cases["ongoing-window"])
        case["proposal"]["preferences"][0]["evidence"] = "fabricated evidence"
        self.assertTrue(validate(case["input"], case["proposal"]))

    def test_missing_context_is_not_successful_empty_result(self):
        self.assertTrue(validate({"transcript": "I am busy."}, {"status": "no_preference_detected", "preferences": []}))

    def test_this_call_cannot_update_future_state(self):
        case = copy.deepcopy(self.cases["ongoing-window"])
        pref = case["proposal"]["preferences"][0]
        pref.update(scope="this_call", duration="one_time")
        self.assertTrue(validate(case["input"], case["proposal"]))
        pref["recommended_action"] = "no_update"
        after, _ = preview(case["input"], case["proposal"], self.crm)
        self.assertEqual(after, self.crm)

    def test_temporary_channel_uses_scoped_record_not_scalar(self):
        case = copy.deepcopy(self.cases["today-only"])
        pref = case["proposal"]["preferences"][0]
        # Adapter boundary test: semantic truth is outside this function.
        pref.update(preference_type="channel", value="sms")
        after, _ = preview(case["input"], case["proposal"], self.crm)
        self.assertIsNone(after["preferred_channel"])
        self.assertEqual(after["scoped_preferences"][0]["duration"], "time_bounded")

    def test_scorer_requires_actual_complete_unique_results(self):
        suite = read_json(ROOT / "tests/golden-test-cases.json")
        with self.assertRaises(ValueError):
            score(suite, {"results": []})
        with self.assertRaises(ValueError):
            score(suite, {"results": [{"id": "x", "output": {}}, {"id": "x", "output": {}}]})

    def test_scorer_flags_broadening(self):
        suite = read_json(ROOT / "tests/golden-test-cases.json")
        suite["cases"] = [suite["cases"][10]]
        actual = copy.deepcopy(self.cases["today-only"]["proposal"])
        actual["preferences"][0].update(scope="organization", duration="ongoing")
        report = score(suite, {"results": [{"id": "golden-11", "output": actual}]})
        self.assertEqual(report["metrics"]["over_broad_update_rate"]["numerator"], 1)
        self.assertEqual(report["metrics"]["case_pass_rate"]["numerator"], 0)

    def test_cli_preview_reject_approve_and_repeat_in_isolated_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            clone = Path(directory) / "skill"
            shutil.copytree(ROOT, clone, ignore=shutil.ignore_patterns("__pycache__"))
            crm = clone / "demo/mock_crm.json"
            original = crm.read_bytes()
            command = [sys.executable, str(clone / "demo/dry_run.py"), "--case", "today-only"]
            def run(extra=(), answer=""):
                result = subprocess.run(command + list(extra), input=answer, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout
            self.assertIn("PREVIEW ONLY", run())
            self.assertEqual(original, crm.read_bytes())
            self.assertIn("REJECTED", run(["--confirm"], "reject\n"))
            self.assertEqual(original, crm.read_bytes())
            self.assertIn("CANCELLED", run(["--confirm"]))
            self.assertEqual(original, crm.read_bytes())
            self.assertIn("APPLIED", run(["--confirm"], "approve\n"))
            approved = crm.read_bytes()
            self.assertNotEqual(original, approved)
            self.assertFalse(json.loads(approved)["global_do_not_call"])
            self.assertIn("NO CHANGE", run(["--confirm"], "approve\n"))
            self.assertEqual(approved, crm.read_bytes())
            command[-1] = "complaint"
            self.assertIn("REVIEW REQUIRED", run(["--confirm"], "approve\n"))
            self.assertEqual(approved, crm.read_bytes())

    def test_global_dnc_cli_requires_operator_approve(self):
        with tempfile.TemporaryDirectory() as directory:
            clone = Path(directory) / "skill"
            shutil.copytree(ROOT, clone, ignore=shutil.ignore_patterns("__pycache__"))
            crm = clone / "demo/mock_crm.json"
            original = crm.read_bytes()
            case = self.global_dnc_case()
            input_path, proposal_path = Path(directory) / "input.json", Path(directory) / "proposal.json"
            input_path.write_text(json.dumps(case["input"]))
            proposal_path.write_text(json.dumps(case["proposal"]))
            command = [sys.executable, str(clone / "demo/dry_run.py"),
                       "--input", str(input_path), "--proposal", str(proposal_path)]
            def run(extra=(), answer=""):
                result = subprocess.run(command + list(extra), input=answer, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout
            output = run(answer="approve\n")
            self.assertIn("OPERATOR APPROVAL REQUIRED", output)
            self.assertIn("PREVIEW ONLY", output)
            self.assertNotIn("REVIEW REQUIRED", output)
            self.assertEqual(original, crm.read_bytes())
            self.assertIn("REJECTED", run(["--confirm"], "reject\n"))
            self.assertEqual(original, crm.read_bytes())
            self.assertIn("CANCELLED", run(["--confirm"]))
            self.assertEqual(original, crm.read_bytes())
            self.assertIn("APPLIED", run(["--confirm"], "approve\n"))
            approved = crm.read_bytes()
            self.assertTrue(json.loads(approved)["global_do_not_call"])
            self.assertIn("NO CHANGE", run(["--confirm"], "approve\n"))
            self.assertEqual(approved, crm.read_bytes())
            self.assertFalse(case["proposal"]["preferences"][0]["requires_human_review"])
            self.assertEqual(proposal_path.read_text(), json.dumps(case["proposal"]))


if __name__ == "__main__":
    unittest.main()
