from __future__ import annotations

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "scope_signal.py"
SPEC = importlib.util.spec_from_file_location("scope_signal", SCRIPT)
assert SPEC and SPEC.loader
scope_signal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scope_signal)


def load(name: str):
    return json.loads((ROOT / "assets" / name).read_text(encoding="utf-8"))


class InputValidationTests(unittest.TestCase):
    def test_valid_input_and_e164_rejection(self):
        valid = load("go-input.json")
        self.assertEqual(scope_signal.validate_input(valid)["request_id"], "northstar-site-go")
        invalid = copy.deepcopy(valid)
        invalid["contact"]["phone_e164"] = "202-555-0123"
        with self.assertRaises(scope_signal.ValidationError):
            scope_signal.validate_input(invalid)

    def test_authorization_and_unknown_fields_fail_closed(self):
        invalid = load("go-input.json")
        invalid["authorization"]["authorization_type"] = "implied"
        with self.assertRaises(scope_signal.ValidationError):
            scope_signal.validate_input(invalid)
        invalid = load("go-input.json")
        invalid["accept_project"] = True
        with self.assertRaises(scope_signal.ValidationError):
            scope_signal.validate_input(invalid)
        invalid = load("go-input.json")
        for source in ("public_listing", "scraped_profile", "assumed", "prior_unrelated_contact"):
            invalid = load("go-input.json")
            invalid["authorization"]["source"] = source
            with self.subTest(source=source), self.assertRaises(scope_signal.ValidationError):
                scope_signal.validate_input(invalid)

    def test_authorization_purpose_and_time_fail_closed(self):
        for purpose in ("Sales call", "Verify some project", ""):
            invalid = load("go-input.json")
            invalid["authorization"]["purpose"] = purpose
            with self.subTest(purpose=purpose), self.assertRaises(scope_signal.ValidationError):
                scope_signal.validate_input(invalid)
        for timestamp in ("2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z", "2026-09-01"):
            invalid = load("go-input.json")
            invalid["authorization"]["authorized_at"] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaises(scope_signal.ValidationError):
                scope_signal.validate_input(invalid)

    def test_sensitive_data_is_rejected(self):
        invalid = load("go-input.json")
        invalid["known_context"] = ["Ask for the bank account number."]
        with self.assertRaises(scope_signal.ValidationError):
            scope_signal.validate_input(invalid)
        invalid = load("go-input.json")
        invalid["language"] = "+1 (202) 555-0199"
        with self.assertRaises(scope_signal.ValidationError):
            scope_signal.validate_input(invalid)


class PreviewTests(unittest.TestCase):
    def test_phone_masking(self):
        self.assertEqual(scope_signal.mask_phone("+12025550123"), "+12*****0123")
        self.assertNotIn("555", scope_signal.mask_phone("+12025550123"))

    def test_digest_is_deterministic_and_content_bound(self):
        raw = load("go-input.json")
        first = scope_signal.build_preview(raw)
        second = scope_signal.build_preview(copy.deepcopy(raw))
        self.assertEqual(first["approval_digest"], second["approval_digest"])
        self.assertEqual(first["idempotency_key"], second["idempotency_key"])
        changed = copy.deepcopy(raw)
        changed["project_summary"] += " Include an additional landing page."
        self.assertNotEqual(first["approval_digest"], scope_signal.build_preview(changed)["approval_digest"])

    def test_digest_binds_every_critical_input(self):
        raw = load("go-input.json")
        baseline = scope_signal.build_preview(raw)["approval_digest"]
        mutations = (
            ("recipient", lambda d: d["contact"].update(phone_e164="+12025550999")),
            ("authorization", lambda d: d["authorization"].update(authorized_by="Project Owner")),
            ("project", lambda d: d.update(project_summary=d["project_summary"] + " Extra scope.")),
            ("context", lambda d: d["known_context"].append("A new verified constraint.")),
            ("language", lambda d: d.update(language="French")),
            ("region", lambda d: d.update(region="CA")),
            ("contact", lambda d: d["contact"].update(name="Jordan Smith")),
        )
        for name, mutate in mutations:
            changed = copy.deepcopy(raw)
            mutate(changed)
            with self.subTest(name=name):
                self.assertNotEqual(baseline, scope_signal.build_preview(changed)["approval_digest"])

    def test_authorization_change_changes_digest(self):
        raw = load("go-input.json")
        changed = copy.deepcopy(raw)
        changed["authorization"]["source"] = "signed_project_agreement"
        self.assertNotEqual(scope_signal.build_preview(raw)["approval_digest"],
                            scope_signal.build_preview(changed)["approval_digest"])

    def test_digest_binds_execution_safety_controls(self):
        raw = load("go-input.json")
        baseline = scope_signal.build_preview(raw)["approval_digest"]
        original = copy.deepcopy(scope_signal.EXECUTION_CONTROLS)
        try:
            scope_signal.EXECUTION_CONTROLS["attempt_limit"] = 99
            self.assertNotEqual(baseline, scope_signal.build_preview(raw)["approval_digest"])
        finally:
            scope_signal.EXECUTION_CONTROLS.clear()
            scope_signal.EXECUTION_CONTROLS.update(original)

    def test_default_is_no_call_and_one_attempt(self):
        preview = scope_signal.build_preview(load("go-input.json"))
        self.assertFalse(preview["call_placed"])
        self.assertTrue(preview["approval_required"])
        self.assertEqual(preview["attempt_limit"], 1)
        self.assertFalse(preview["automatic_retries"])
        self.assertFalse(preview["recurring"])
        self.assertEqual(preview["provider_workflow"], ["plan_call", "run_call", "get_call_run"])

    def test_cli_preview_is_offline_no_call(self):
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), "preview", "--input", str(ROOT / "assets" / "go-input.json")],
            check=True, capture_output=True, text=True,
        )
        payload = json.loads(completed.stdout)
        self.assertFalse(payload["call_placed"])
        self.assertIn("No call was placed", payload["notice"])
        self.assertNotIn(load("go-input.json")["contact"]["phone_e164"], completed.stdout)

    def test_provider_handoff_is_explicit_file_only_and_0600(self):
        raw = load("go-input.json")
        digest = scope_signal.build_preview(raw)["approval_digest"]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "handoff.json"
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "handoff", "--input", str(ROOT / "assets" / "go-input.json"),
                 "--approved-digest", digest, "--output", str(target)],
                check=True, capture_output=True, text=True,
            )
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertIn(raw["contact"]["phone_e164"], target.read_text())
            self.assertNotIn(raw["contact"]["phone_e164"], completed.stdout + completed.stderr)

    def test_errors_do_not_echo_paths_or_pii(self):
        secret = "/tmp/+12025550123-person@example.test.json"
        completed = subprocess.run(
            [sys.executable, str(SCRIPT), "preview", "--input", secret],
            capture_output=True, text=True,
        )
        self.assertEqual(completed.returncode, 2)
        self.assertNotIn(secret, completed.stderr)
        self.assertNotIn("+12025550123", completed.stderr)
        self.assertNotIn("person@example.test", completed.stderr)


class ReconciliationTests(unittest.TestCase):
    def change_evidence(self, field, quote, value):
        fixture = load("go-result.json")
        old = fixture["result"][field]["quote"]
        fixture["transcript"][1]["text"] = fixture["transcript"][1]["text"].replace(old, quote)
        fixture["result"][field] = {"value": value, "quote": quote}
        return scope_signal.reconcile(load("go-input.json"), fixture)

    def test_go_caution_and_refusal_fixtures(self):
        cases = (("go", "GO"), ("caution", "CAUTION"), ("no-go", "NO-GO"))
        for stem, expected in cases:
            with self.subTest(stem=stem):
                result = scope_signal.reconcile(load(f"{stem}-input.json"), load(f"{stem}-result.json"))
                self.assertEqual(result["brief"]["recommendation"], expected)
                self.assertEqual(result["brief"]["final_decision_owner"], "human")
                self.assertNotIn(load(f"{stem}-input.json")["contact"]["phone_e164"], json.dumps(result))

    def test_agent_speech_cannot_ground_a_field(self):
        fixture = load("go-result.json")
        quote = fixture["result"]["budget_range_currency"]["quote"]
        fixture["transcript"][1]["text"] = fixture["transcript"][1]["text"].replace(quote, "")
        fixture["transcript"].append({"speaker": "agent", "text": quote})
        result = scope_signal.reconcile(load("go-input.json"), fixture)
        self.assertFalse(result["evidence"]["budget_range_currency"]["verified"])
        self.assertEqual(result["brief"]["recommendation"], "CAUTION")

    def test_unsupported_structured_value_is_not_evidence(self):
        fixture = load("go-result.json")
        fixture["result"]["deliverables"]["quote"] = "This sentence was never spoken."
        result = scope_signal.reconcile(load("go-input.json"), fixture)
        self.assertEqual(result["evidence"]["deliverables"]["value"], "unknown")
        self.assertEqual(result["brief"]["recommendation"], "CAUTION")

    def test_noncompleted_status_is_no_go_even_with_quotes(self):
        fixture = load("go-result.json")
        fixture["status"] = "VOICEMAIL"
        result = scope_signal.reconcile(load("go-input.json"), fixture)
        self.assertEqual(result["brief"]["recommendation"], "NO-GO")
        self.assertFalse(any(item["verified"] for item in result["evidence"].values()))

    def test_explicit_lack_of_authority_is_no_go(self):
        fixture = load("go-result.json")
        old = fixture["result"]["decision_authority"]["quote"]
        new = "I do not have decision authority for this project."
        fixture["transcript"][1]["text"] = fixture["transcript"][1]["text"].replace(old, new)
        fixture["result"]["decision_authority"] = {"value": "I do not have decision authority", "quote": new}
        result = scope_signal.reconcile(load("go-input.json"), fixture)
        self.assertEqual(result["brief"]["recommendation"], "NO-GO")

    def test_changed_preview_digest_is_rejected(self):
        fixture = load("go-result.json")
        fixture["approval_digest"] = "sha256:" + "0" * 64
        with self.assertRaises(scope_signal.ValidationError):
            scope_signal.reconcile(load("go-input.json"), fixture)

    def test_tiny_generic_duplicate_and_contradictory_quotes_fail_closed(self):
        for quote in ("x", "Yes that is correct."):
            result = self.change_evidence("deliverables", quote, "Five pages")
            with self.subTest(quote=quote):
                self.assertFalse(result["evidence"]["deliverables"]["verified"])
                self.assertNotEqual(result["brief"]["recommendation"], "GO")
        contradiction = self.change_evidence(
            "funding_or_deposit_status", "The project deposit has been funded.", "NOT_FUNDED")
        self.assertFalse(contradiction["evidence"]["funding_or_deposit_status"]["verified"])
        fixture = load("go-result.json")
        duplicate = fixture["result"]["deliverables"]["quote"]
        fixture["result"]["exclusions"] = {"value": "Five responsive pages", "quote": duplicate}
        result = scope_signal.reconcile(load("go-input.json"), fixture)
        self.assertFalse(result["evidence"]["deliverables"]["verified"])
        self.assertFalse(result["evidence"]["exclusions"]["verified"])

    def test_funding_states_never_false_go(self):
        cases = (
            ("The project deposit is not funded.", "NOT_FUNDED", "NOT_FUNDED"),
            ("The project funding is still pending.", "PENDING", "PENDING"),
            ("The project deposit will be funded after board approval.", "CONDITIONAL", "CONDITIONAL"),
        )
        for quote, supplied, expected in cases:
            result = self.change_evidence("funding_or_deposit_status", quote, supplied)
            with self.subTest(expected=expected):
                self.assertEqual(result["evidence"]["funding_or_deposit_status"]["value"], expected)
                self.assertEqual(result["brief"]["recommendation"], "CAUTION")

    def test_authority_states_are_no_go(self):
        cases = (
            ("The board makes the final project decision.", "board decides", "THIRD_PARTY"),
            ("The CFO approves the final project decision.", "CFO approves", "THIRD_PARTY"),
            ("I share final decision authority with the board.", "joint authority", "SELF_PARTIAL"),
            ("I need the CFO approval for the final decision.", "partial authority", "SELF_PARTIAL"),
            ("I do not have final decision authority.", "no authority", "NONE"),
        )
        for quote, supplied, expected in cases:
            result = self.change_evidence("decision_authority", quote, supplied)
            with self.subTest(expected=expected):
                self.assertEqual(result["evidence"]["decision_authority"]["value"], expected)
                self.assertEqual(result["brief"]["recommendation"], "NO-GO")

    def test_budget_only_authority_is_not_final(self):
        result = self.change_evidence(
            "decision_authority",
            "I have final authority over the budget only.",
            "partial authority",
        )
        self.assertEqual(result["evidence"]["decision_authority"]["value"], "SELF_PARTIAL")
        self.assertEqual(result["brief"]["recommendation"], "NO-GO")

    def test_negating_turn_context_invalidates_embedded_claims(self):
        fixture = load("go-result.json")
        fixture["transcript"][1]["text"] = (
            "Every factual sentence that follows is false. " + fixture["transcript"][1]["text"]
        )
        result = scope_signal.reconcile(load("go-input.json"), fixture)
        self.assertFalse(any(item["verified"] for item in result["evidence"].values()))
        self.assertNotEqual(result["brief"]["recommendation"], "GO")

    def test_ordinary_field_value_negation_is_rejected(self):
        fixture = load("go-result.json")
        fixture["result"]["deliverables"]["value"] = (
            "Not five responsive pages, a contact form, and launch support"
        )
        result = scope_signal.reconcile(load("go-input.json"), fixture)
        self.assertFalse(result["evidence"]["deliverables"]["verified"])
        self.assertNotEqual(result["brief"]["recommendation"], "GO")

    def test_reconciled_outputs_redact_pii_everywhere(self):
        fixture = load("go-result.json")
        old = fixture["result"]["deliverables"]["quote"]
        pii = ("The deliverables are a site for person@example.test, +120****9876, "
               "accounts 1234/5678/9012/3456 and ABCD1234EFGH5678.")
        fixture["transcript"][1]["text"] = fixture["transcript"][1]["text"].replace(old, pii)
        fixture["result"]["deliverables"] = {
            "value": "person@example.test +120****9876 1234/5678/9012/3456 ABCD1234EFGH5678",
            "quote": pii,
        }
        output = json.dumps(scope_signal.reconcile(load("go-input.json"), fixture))
        for secret in ("person@example.test", "+120****9876", "1234/5678/9012/3456", "ABCD1234EFGH5678"):
            self.assertNotIn(secret, output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
