import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vaxcheck.classify import sanitize
from vaxcheck.schema import RECIPIENT_RESULT_SCHEMA, enum_for, recipient_fields


class TestSchema(unittest.TestCase):
    def test_required_fields_are_defined(self):
        for field in RECIPIENT_RESULT_SCHEMA["required"]:
            self.assertIn(field, RECIPIENT_RESULT_SCHEMA["properties"])

    def test_every_decision_field_is_a_closed_enum(self):
        for field in ("reached_guardian", "identity_confirmed", "consent", "route",
                      "allergy_reported", "unwell_today", "prior_dose_reported"):
            self.assertIsInstance(enum_for(field), list, field)

    def test_unsure_is_representable(self):
        self.assertIn("unsure", enum_for("allergy_reported"))
        self.assertIn("unknown", enum_for("consent"))

    def test_sanitize_drops_unknown_fields(self):
        out = sanitize({"consent": "granted", "injected_field": "evil"})
        self.assertEqual(out, {"consent": "granted"})

    def test_sanitize_drops_illegal_enum_values(self):
        self.assertEqual(sanitize({"consent": "probably"}), {})
        self.assertEqual(sanitize({"route": "somewhere_else"}), {})

    def test_sanitize_survives_junk(self):
        for junk in (None, [], "text", 5):
            self.assertEqual(sanitize(junk), {})

    def test_free_text_fields_pass_through_trimmed(self):
        out = sanitize({"allergy_detail": "  peanuts  "})
        self.assertEqual(out["allergy_detail"], "peanuts")

    def test_field_count_is_stable(self):
        self.assertEqual(len(recipient_fields()), 11)


if __name__ == "__main__":
    unittest.main()
