import sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vaxcheck.classify import record_from_call
from vaxcheck.origins import OriginError, approved_base_url
from vaxcheck.phone import InvalidPhone, normalize, redact
from vaxcheck.roster import load


class TestOrigins(unittest.TestCase):
    def test_default_is_the_approved_origin(self):
        self.assertEqual(approved_base_url(None), "https://api.heycall-e.com")
        self.assertEqual(approved_base_url("https://api.heycall-e.com/"), "https://api.heycall-e.com")

    def test_rejects_other_hosts_schemes_ports_and_paths(self):
        for bad in ("http://api.heycall-e.com", "https://evil.example", "https://api.heycall-e.com.evil.example",
                    "https://user:pw@api.heycall-e.com", "https://api.heycall-e.com:8443", "https://api.heycall-e.com/v1"):
            with self.assertRaises(OriginError, msg=bad):
                approved_base_url(bad)


class TestAsciiPhone(unittest.TestCase):
    def test_normalises_documented_formatting_only(self):
        self.assertEqual(normalize(" +1 (415) 555-0101 "), "+14155550101")
        self.assertEqual(normalize("+1.415.555.0101"), "+14155550101")
        self.assertEqual(normalize("+14155550101\n"), "+14155550101")  # surrounding whitespace is normalisation

    def test_rejects_unicode_digits_and_stray_characters(self):
        for bad in ("+1415555010\u0661", "+14155550101x", "+14155550101\u200b", "\uff0b14155550101", "+1 415 555 0101 ext 2"):
            with self.assertRaises(InvalidPhone, msg=repr(bad)):
                normalize(bad)

    def test_pattern_is_a_full_match_not_a_dollar_anchor(self):
        from vaxcheck.phone import E164
        self.assertIsNone(E164.fullmatch("+14155550101\n"))
        self.assertIsNone(E164.fullmatch("+1415555010\u0661"))
        self.assertIsNotNone(E164.fullmatch("+14155550101"))


class TestRedact(unittest.TestCase):
    def test_masks_numbers_inside_free_text(self):
        out = redact("Please call me back on +1 415 555 0199 after 5pm")
        self.assertNotIn("555 0199", out)
        self.assertNotIn("5550199", out)
        self.assertIn("0199", out)

    def test_leaves_short_numbers_and_dates_alone(self):
        self.assertEqual(redact("dose 1 on 2026-10-02, class P5-B"), "dose 1 on 2026-10-02, class P5-B")
        self.assertEqual(redact("seen on 02/10/2026"), "seen on 02/10/2026")

    def test_masks_a_seven_digit_local_number(self):
        self.assertNotIn("555-0199", redact("ring 555-0199"))

    def test_free_text_results_are_redacted_at_ingestion(self):
        session, students = load(ROOT / "fixtures" / "sample_roster.json")
        call = {"id": "c", "task_completed": True, "completion_confidence": {"score": 0.9},
                "evidence": ["Guardian gave +14155550177 as a second number"],
                "summary": "Reach dad on 415-555-0188",
                "recipients": [{"phones": [students[0].guardian_phone], "structured_result": {
                    "reached_guardian": "yes", "consent": "granted", "route": "school_session",
                    "guardian_questions": "Can you call +1 (415) 555-0166 instead?"}}]}
        rec = record_from_call(call, students[0])
        blob = str(rec.to_dict())
        for raw in ("5550177", "555-0188", "555-0166"):
            self.assertNotIn(raw, blob)


class TestResumeBinding(unittest.TestCase):
    def test_binding_requires_matching_metadata(self):
        try:
            from vaxcheck.live_client import LiveClientError, bind_resumed_call
        except ImportError:
            self.skipTest("SDK not installed")
        session, students = load(ROOT / "fixtures" / "sample_roster.json")
        good = {"id": "call_1", "metadata": {"app": "vaxcheck", "student_id": "S-043",
                "school": session.school_name, "session_date": session.session_date}}
        priya = next(s for s in students if s.student_id == "S-043")
        self.assertIs(bind_resumed_call(good, session, priya), good)
        sibling = {"id": "call_2", "metadata": {**good["metadata"], "student_id": "S-045"}}
        with self.assertRaises(LiveClientError):
            bind_resumed_call(sibling, session, priya)
        with self.assertRaises(LiveClientError):
            bind_resumed_call({"id": "call_3", "metadata": {}}, session, priya)
        with self.assertRaises(LiveClientError):
            bind_resumed_call({"id": "call_4"}, session, priya)


if __name__ == "__main__":
    unittest.main()
