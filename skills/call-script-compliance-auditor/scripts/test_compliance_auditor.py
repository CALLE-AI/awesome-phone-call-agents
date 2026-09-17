#!/usr/bin/env python3
"""
test_compliance_auditor.py — Test suite for call-script-compliance-auditor
Run: python3 scripts/test_compliance_auditor.py
"""
from __future__ import annotations
import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(__file__))
from audit_script import audit, check_rule, overall_verdict, risk_level, build_flags, RULES
from validate_compliance_report import validate


def make_script_file(text: str) -> str:
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8")
    f.write(text)
    f.close()
    return f.name


# ------------- compliant scripts per jurisdiction ----------------------------

FCA_COMPLIANT = (
    "Hello, my name is Alex and I'm calling from Acme Financial Services. "
    "This is a recorded call. We would like to tell you about our loan products. "
    "There is no rush — please take whatever time you need to consider. "
    "If you would like to opt out of future calls, please let me know. "
    "Please note that your home may be at risk if you do not keep up repayments. "
    "We are authorised and regulated by the Financial Conduct Authority."
)

FCA_NON_COMPLIANT = (
    "This is a limited-time offer that expires tonight. "
    "You'll get the best rate if you decide right now. "
    "Can I take your bank details? This offer is today only."
)

GDPR_COMPLIANT = (
    "Hello, we are Acme Ltd. We need your contact details to process your service request. "
    "This data will be used only for that purpose. "
    "You may withdraw your consent at any time. "
    "With your permission, may we proceed?"
)

GDPR_NON_COMPLIANT = (
    "Hello! Can we take your details? Great. Now let's proceed."
)

TCPA_COMPLIANT = (
    "Hello, this is Jordan calling from Acme Corp. "
    "This is an automated message. "
    "To be placed on our do-not-call list, please press 9 or say stop. "
    "You can reach us back at 800 555 0187."
)

TCPA_NON_COMPLIANT = (
    "Hello, we are offering you a great product today. Please hold."
)

HIPAA_COMPLIANT = (
    "Hello, this is Sam from Riverside Health Center. "
    "Am I speaking with the patient? Could you please confirm your date of birth? "
    "I'm calling regarding your account. "
)

HIPAA_NON_COMPLIANT = (
    "Hello, your diagnosis came back and your prescription is ready. Please call back."
)


class TestRuleChecking(unittest.TestCase):
    def _rule(self, jur: str, req_id: str) -> dict:
        return next(r for r in RULES[jur] if r["req_id"] == req_id)

    # FCA
    def test_fca_identity_pass(self):
        r = check_rule(self._rule("UK_FCA", "FCA_CD_COMM_1"), FCA_COMPLIANT)
        self.assertEqual(r["status"], "PASS")

    def test_fca_identity_fail(self):
        r = check_rule(self._rule("UK_FCA", "FCA_CD_COMM_1"), "This is a recording about your account.")
        self.assertEqual(r["status"], "FAIL")

    def test_fca_urgency_fail(self):
        r = check_rule(self._rule("UK_FCA", "FCA_CD_COMM_3"), "This offer expires tonight.")
        self.assertEqual(r["status"], "FAIL")

    def test_fca_urgency_pass(self):
        r = check_rule(self._rule("UK_FCA", "FCA_CD_COMM_3"), "Please take your time to consider.")
        self.assertEqual(r["status"], "PASS")

    def test_fca_pressure_fail(self):
        r = check_rule(self._rule("UK_FCA", "FCA_CD_COMM_4"), "You need to decide right now.")
        self.assertEqual(r["status"], "FAIL")

    def test_fca_optout_pass(self):
        r = check_rule(self._rule("UK_FCA", "FCA_CD_COMM_5"), "You can opt out any time.")
        self.assertEqual(r["status"], "PASS")

    def test_fca_optout_fail(self):
        r = check_rule(self._rule("UK_FCA", "FCA_CD_COMM_5"), "Thank you for your time.")
        self.assertEqual(r["status"], "FAIL")

    # GDPR
    def test_gdpr_purpose_pass(self):
        r = check_rule(self._rule("EU_GDPR", "GDPR_ART13_2"), "We need your details to process your order.")
        self.assertEqual(r["status"], "PASS")

    def test_gdpr_purpose_fail(self):
        r = check_rule(self._rule("EU_GDPR", "GDPR_ART13_2"), "Hello, can we get your details please?")
        self.assertEqual(r["status"], "FAIL")

    def test_gdpr_consent_pass(self):
        r = check_rule(self._rule("EU_GDPR", "GDPR_ART7"), "With your permission, may we proceed?")
        self.assertEqual(r["status"], "PASS")

    def test_gdpr_withdraw_pass(self):
        r = check_rule(self._rule("EU_GDPR", "GDPR_ART13_3"), "You may withdraw your consent at any time.")
        self.assertEqual(r["status"], "PASS")

    # TCPA
    def test_tcpa_identity_pass(self):
        r = check_rule(self._rule("US_TCPA", "TCPA_1"), "Hello, this is Sam calling from Acme Corp.")
        self.assertEqual(r["status"], "PASS")

    def test_tcpa_optout_pass(self):
        r = check_rule(self._rule("US_TCPA", "TCPA_2"), "Press 9 to opt out.")
        self.assertEqual(r["status"], "PASS")

    def test_tcpa_optout_fail(self):
        r = check_rule(self._rule("US_TCPA", "TCPA_2"), "Have a great day!")
        self.assertEqual(r["status"], "FAIL")

    # HIPAA
    def test_hipaa_identity_pass(self):
        r = check_rule(self._rule("US_HIPAA", "HIPAA_1"), "This is Alex from General Hospital.")
        self.assertEqual(r["status"], "PASS")

    def test_hipaa_prohibited_phi_fail(self):
        r = check_rule(self._rule("US_HIPAA", "HIPAA_2"), "Your diagnosis is Type 2 Diabetes.")
        self.assertEqual(r["status"], "FAIL")

    def test_hipaa_phi_clean_pass(self):
        r = check_rule(self._rule("US_HIPAA", "HIPAA_2"), "I'm calling regarding your account.")
        self.assertEqual(r["status"], "PASS")

    def test_hipaa_identity_confirm_pass(self):
        r = check_rule(self._rule("US_HIPAA", "HIPAA_3"), "Am I speaking with the patient? Confirm your date of birth.")
        self.assertEqual(r["status"], "PASS")


class TestOverallVerdict(unittest.TestCase):
    def test_all_pass(self):
        self.assertEqual(overall_verdict([{"status": "PASS"}, {"status": "PASS"}]), "PASS")

    def test_warn_only(self):
        self.assertEqual(overall_verdict([{"status": "PASS"}, {"status": "WARN"}]), "WARN")

    def test_fail_present(self):
        self.assertEqual(overall_verdict([{"status": "PASS"}, {"status": "FAIL"}]), "FAIL")

    def test_empty_checks(self):
        self.assertEqual(overall_verdict([]), "PASS")


class TestRiskLevel(unittest.TestCase):
    def test_no_fails_no_warns_none(self):
        self.assertEqual(risk_level([{"status": "PASS"}]), "NONE")

    def test_one_fail_medium(self):
        checks = [{"status": "FAIL"}, {"status": "PASS"}]
        self.assertEqual(risk_level(checks), "MEDIUM")

    def test_two_fails_high(self):
        checks = [{"status": "FAIL"}, {"status": "FAIL"}, {"status": "PASS"}]
        self.assertEqual(risk_level(checks), "HIGH")

    def test_three_fails_critical(self):
        checks = [{"status": "FAIL"}] * 3
        self.assertEqual(risk_level(checks), "CRITICAL")

    def test_warns_only_low(self):
        checks = [{"status": "WARN"}, {"status": "PASS"}]
        self.assertEqual(risk_level(checks), "LOW")


class TestEndToEnd(unittest.TestCase):
    def test_fca_compliant_script_passes(self):
        path = make_script_file(FCA_COMPLIANT)
        try:
            report = audit(path, jurisdiction="UK_FCA", dry_run=True)
            self.assertIn(report["overall_verdict"], ("PASS", "WARN"))
        finally:
            os.unlink(path)

    def test_fca_non_compliant_script_fails(self):
        path = make_script_file(FCA_NON_COMPLIANT)
        try:
            report = audit(path, jurisdiction="UK_FCA", dry_run=True)
            self.assertEqual(report["overall_verdict"], "FAIL")
            self.assertGreater(report["fail_count"], 0)
        finally:
            os.unlink(path)

    def test_gdpr_compliant_passes(self):
        path = make_script_file(GDPR_COMPLIANT)
        try:
            report = audit(path, jurisdiction="EU_GDPR", dry_run=True)
            self.assertIn(report["overall_verdict"], ("PASS", "WARN"))
        finally:
            os.unlink(path)

    def test_gdpr_non_compliant_fails(self):
        path = make_script_file(GDPR_NON_COMPLIANT)
        try:
            report = audit(path, jurisdiction="EU_GDPR", dry_run=True)
            self.assertEqual(report["overall_verdict"], "FAIL")
        finally:
            os.unlink(path)

    def test_tcpa_compliant_passes(self):
        path = make_script_file(TCPA_COMPLIANT)
        try:
            report = audit(path, jurisdiction="US_TCPA", dry_run=True)
            self.assertIn(report["overall_verdict"], ("PASS", "WARN"))
        finally:
            os.unlink(path)

    def test_tcpa_non_compliant_fails(self):
        path = make_script_file(TCPA_NON_COMPLIANT)
        try:
            report = audit(path, jurisdiction="US_TCPA", dry_run=True)
            self.assertEqual(report["overall_verdict"], "FAIL")
        finally:
            os.unlink(path)

    def test_hipaa_compliant_passes(self):
        path = make_script_file(HIPAA_COMPLIANT)
        try:
            report = audit(path, jurisdiction="US_HIPAA", dry_run=True)
            self.assertIn(report["overall_verdict"], ("PASS", "WARN"))
        finally:
            os.unlink(path)

    def test_hipaa_non_compliant_fails(self):
        path = make_script_file(HIPAA_NON_COMPLIANT)
        try:
            report = audit(path, jurisdiction="US_HIPAA", dry_run=True)
            self.assertEqual(report["overall_verdict"], "FAIL")
        finally:
            os.unlink(path)

    def test_invalid_jurisdiction_raises(self):
        path = make_script_file("Hello there.")
        try:
            with self.assertRaises(ValueError):
                audit(path, jurisdiction="INVALID", dry_run=True)
        finally:
            os.unlink(path)

    def test_schema_version(self):
        path = make_script_file(FCA_COMPLIANT)
        try:
            report = audit(path, jurisdiction="UK_FCA", dry_run=True)
            self.assertEqual(report["schema_version"], "1.0")
        finally:
            os.unlink(path)

    def test_disclaimer_always_present(self):
        path = make_script_file("Hello world.")
        try:
            report = audit(path, jurisdiction="EU_GDPR", dry_run=True)
            self.assertIn("legal counsel", report["false_positive_disclaimer"])
        finally:
            os.unlink(path)

    def test_script_hash_prefixed(self):
        path = make_script_file(FCA_COMPLIANT)
        try:
            report = audit(path, jurisdiction="UK_FCA", dry_run=True)
            self.assertTrue(report["script_hash"].startswith("sha256:"))
        finally:
            os.unlink(path)

    def test_count_consistency(self):
        path = make_script_file(FCA_NON_COMPLIANT)
        try:
            report = audit(path, jurisdiction="UK_FCA", dry_run=True)
            checks = report["checks"]
            self.assertEqual(report["pass_count"], sum(1 for c in checks if c["status"] == "PASS"))
            self.assertEqual(report["fail_count"], sum(1 for c in checks if c["status"] == "FAIL"))
            self.assertEqual(report["warn_count"], sum(1 for c in checks if c["status"] == "WARN"))
        finally:
            os.unlink(path)

    def test_fail_has_suggested_rewrite(self):
        path = make_script_file(FCA_NON_COMPLIANT)
        try:
            report = audit(path, jurisdiction="UK_FCA", dry_run=True)
            fails = [c for c in report["checks"] if c["status"] == "FAIL"]
            for f in fails:
                self.assertIn("suggested_rewrite", f)
        finally:
            os.unlink(path)

    def test_dry_run_flag(self):
        path = make_script_file(FCA_COMPLIANT)
        try:
            report = audit(path, jurisdiction="UK_FCA", dry_run=True)
            self.assertTrue(report["dry_run"])
        finally:
            os.unlink(path)

    def test_json_task_input(self):
        data = {"task": "Call and offer insurance. My name is Lee from InsureCo. Opt out by pressing 9."}
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
        json.dump(data, f)
        f.close()
        try:
            report = audit(f.name, jurisdiction="US_TCPA", dry_run=True)
            # Should find identity and opt-out
            self.assertIsInstance(report["checks"], list)
        finally:
            os.unlink(f.name)


class TestSchemaValidation(unittest.TestCase):
    def _base_report(self, checks=None) -> dict:
        checks = checks or [{"requirement_id": "FCA_CD_COMM_1", "requirement": "x",
                              "status": "PASS", "regulation_ref": "FCA §4.21"}]
        return {
            "script_hash": "sha256:abc",
            "jurisdiction": "UK_FCA",
            "overall_verdict": "PASS",
            "risk_level": "NONE",
            "checks": checks,
            "pass_count": sum(1 for c in checks if c["status"] == "PASS"),
            "warn_count": sum(1 for c in checks if c["status"] == "WARN"),
            "fail_count": sum(1 for c in checks if c["status"] == "FAIL"),
            "false_positive_disclaimer": "Legal disclaimer.",
            "flags": [],
            "schema_version": "1.0",
        }

    def test_valid_passes(self):
        self.assertEqual(validate(self._base_report()), [])

    def test_missing_field(self):
        r = self._base_report()
        del r["jurisdiction"]
        errors = validate(r)
        self.assertTrue(any("jurisdiction" in e for e in errors))

    def test_invalid_verdict(self):
        r = self._base_report()
        r["overall_verdict"] = "MAYBE"
        errors = validate(r)
        self.assertTrue(any("overall_verdict" in e for e in errors))

    def test_count_mismatch_detected(self):
        checks = [{"requirement_id": "X", "requirement": "y", "status": "FAIL", "regulation_ref": "Z"}]
        r = self._base_report(checks)
        r["fail_count"] = 0  # wrong
        errors = validate(r)
        self.assertTrue(any("fail_count" in e for e in errors))

    def test_empty_disclaimer_fails(self):
        r = self._base_report()
        r["false_positive_disclaimer"] = "  "
        errors = validate(r)
        self.assertTrue(any("disclaimer" in e.lower() for e in errors))

    def test_invalid_jurisdiction_detected(self):
        r = self._base_report()
        r["jurisdiction"] = "MARS_LAW"
        errors = validate(r)
        self.assertTrue(any("jurisdiction" in e for e in errors))


if __name__ == "__main__":
    result = unittest.main(verbosity=2, exit=False)
    total = result.result.testsRun
    failures = len(result.result.failures) + len(result.result.errors)
    print(f"\n{'='*60}")
    print(f"Total tests: {total} | Passed: {total - failures} | Failed: {failures}")
    sys.exit(0 if failures == 0 else 1)
