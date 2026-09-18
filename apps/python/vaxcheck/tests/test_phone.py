import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vaxcheck.phone import InvalidPhone, mask, normalize, region_of


class TestPhone(unittest.TestCase):
    def test_normalize_strips_formatting(self):
        self.assertEqual(normalize(" +1 (415) 555-0101 "), "+14155550101")

    def test_rejects_non_e164(self):
        for bad in ["4155550101", "+0123", "", "++1415", "phone"]:
            with self.assertRaises(InvalidPhone):
                normalize(bad)

    def test_rejects_non_string(self):
        with self.assertRaises(InvalidPhone):
            normalize(14155550101)

    def test_mask_hides_middle_keeps_tail(self):
        masked = mask("+14155550101")
        self.assertTrue(masked.endswith("0101"))
        self.assertNotIn("5555", masked)
        self.assertEqual(len(masked), len("+14155550101"))

    def test_mask_is_safe_on_junk(self):
        self.assertEqual(mask(""), "****")
        self.assertEqual(mask(None), "****")

    def test_region_of(self):
        self.assertEqual(region_of("+6591000000"), "SG")
        self.assertEqual(region_of("+14155550101"), "US")
        self.assertIsNone(region_of("+441234567890"))


if __name__ == "__main__":
    unittest.main()
