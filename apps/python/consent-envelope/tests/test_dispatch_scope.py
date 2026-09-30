from pathlib import Path
import unittest
from consent_gate import Authorization


class DispatchScopeTests(unittest.TestCase):
    def setUp(self):
        self.auth = Authorization.from_json(Path(__file__).resolve().parents[1] / "examples" / "authorization.json")

    def test_exact_preview(self):
        self.assertEqual(self.auth.validate_dispatch("Call about pharmacy hours", "+15555550123", False), [])

    def test_changed_recipient(self):
        self.assertIn("recipient differs from the authorized recipient", self.auth.validate_dispatch("Call about pharmacy hours", "+15555550124", False))

    def test_appended_instruction(self):
        self.assertIn("task differs from the exact approved task", self.auth.validate_dispatch("Call about pharmacy hours and order medicine", "+15555550123", False))

    def test_demo_cannot_dial(self):
        self.assertIn("demo authorization cannot execute live", self.auth.validate_dispatch("Call about pharmacy hours", "+15555550123", True))
