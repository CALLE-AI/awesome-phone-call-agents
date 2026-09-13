import json
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from appointment_confirm.schema import load_intake, validate_intake

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.intake = json.loads((FIXTURES / "sample_appointment.json").read_text())

    def test_sample_loads(self):
        loaded = load_intake(FIXTURES / "sample_appointment.json")
        self.assertEqual(loaded["request_id"], "apt-2026-09-03-amelia")
        self.assertTrue(loaded["consent"])

    def test_rejects_false_consent(self):
        self.intake["consent"] = False
        with self.assertRaises(ValueError):
            validate_intake(self.intake)

    def test_rejects_do_not_call(self):
        self.intake["do_not_call"] = True
        with self.assertRaises(ValueError):
            validate_intake(self.intake)

    def test_rejects_secret_like_fields(self):
        self.intake["authorized_reason"] = "here is an api_key leak"
        with self.assertRaises(ValueError):
            validate_intake(self.intake)

    def test_rejects_naive_datetime(self):
        self.intake["appointment"]["starts_at"] = "2026-09-03T10:00:00"
        with self.assertRaises(ValueError):
            validate_intake(self.intake)


if __name__ == "__main__":
    unittest.main()
