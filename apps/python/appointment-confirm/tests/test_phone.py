import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from appointment_confirm.phone import mask_phone, validate_e164


class PhoneTests(unittest.TestCase):
    def test_accepts_gb_drama_number(self):
        self.assertEqual(validate_e164("+447700900123"), "+447700900123")

    def test_rejects_missing_plus(self):
        with self.assertRaises(ValueError):
            validate_e164("447700900123")

    def test_rejects_plus_zero(self):
        with self.assertRaises(ValueError):
            validate_e164("+0447700900123")

    def test_mask_keeps_last_four(self):
        masked = mask_phone("+447700900123")
        self.assertTrue(masked.endswith("0123"))
        self.assertNotIn("7700900", masked)
        self.assertIn("*", masked)


if __name__ == "__main__":
    unittest.main()
