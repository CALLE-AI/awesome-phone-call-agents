"""Tests for default call safety and log redaction."""

import unittest
from pathlib import Path

from shift_safety_call_agent.application.services import (
    DEFAULT_ALLOW_REAL_CALLS,
    DEFAULT_CALL_PROVIDER,
    real_call_configuration_requested,
    safe_log_context,
)


class SafetyPolicyTests(unittest.TestCase):
    """Verify safe defaults and redaction helpers."""

    def test_real_calls_are_disabled_by_default(self) -> None:
        self.assertEqual(DEFAULT_CALL_PROVIDER, "fake")
        self.assertIs(DEFAULT_ALLOW_REAL_CALLS, False)
        self.assertIs(real_call_configuration_requested({}), False)
        self.assertIs(real_call_configuration_requested({"ALLOW_REAL_CALLS": "true"}), False)
        self.assertIs(
            real_call_configuration_requested({"ALLOW_REAL_CALLS": "true", "CALL_PROVIDER": "calle"}),
            True,
        )

    def test_public_readme_documents_safe_defaults_without_an_env_file(self) -> None:
        root = Path(__file__).resolve().parents[2]
        text = (root / "README.md").read_text(encoding="utf-8")
        self.assertIn("CALL_PROVIDER=fake", text)
        self.assertIn("ALLOW_REAL_CALLS=false", text)
        self.assertFalse((root / ".env.example").exists())
        self.assertIn("No credentials or environment file are needed", text)

    def test_sensitive_values_are_not_returned_in_log_context(self) -> None:
        original = {
            "CALLE_API_KEY": "example-secret-value",
            "oauth_token": "example-oauth-value",
            "phone_number": "555-010-3456",
            "transcript": "private words",
            "scenario": "no-incident",
        }
        sanitized = safe_log_context(original)
        rendered = repr(sanitized)
        self.assertNotIn("example-secret-value", rendered)
        self.assertNotIn("example-oauth-value", rendered)
        self.assertNotIn("private words", rendered)
        self.assertNotIn("555-010-3456", rendered)
        self.assertEqual(sanitized["phone_number"], "***-***-3456")
        self.assertEqual(sanitized["scenario"], "no-incident")


if __name__ == "__main__":
    unittest.main()
