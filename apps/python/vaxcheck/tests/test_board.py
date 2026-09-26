import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vaxcheck import board, report
from vaxcheck.classify import records_from_calls
from vaxcheck.mock_client import build_calls, load_fixture
from vaxcheck.roster import load

FIXTURES = ["conversation_consent_school.json", "conversation_private_provider.json",
            "conversation_allergy_severe.json", "conversation_decline.json",
            "conversation_unsure.json", "conversation_voicemail.json"]


class TestBoard(unittest.TestCase):
    def setUp(self):
        self.session, self.students = load(ROOT / "fixtures" / "sample_roster.json")
        pairs = build_calls(self.students, [load_fixture(f) for f in FIXTURES])
        self.roster = report.to_json(records_from_calls(pairs), self.session)
        self.html = board.render(self.roster)

    def test_every_student_has_a_card(self):
        for s in self.students:
            self.assertIn(f'id="card-{s.student_id}"', self.html)
            self.assertIn(s.student_name, self.html)

    def test_no_raw_phone_number_anywhere(self):
        for s in self.students:
            self.assertNotIn(s.guardian_phone, self.html)
        self.assertIn("+14*****0103", self.html)

    def test_review_queue_comes_before_cleared(self):
        self.assertLess(self.html.index("Nurse review required"), self.html.index("Cleared for session"))

    def test_review_card_shows_consent_beside_the_flag(self):
        card = self.html[self.html.index('id="card-S-043"'):self.html.index('id="card-S-045"')]
        self.assertIn("granted", card)
        self.assertIn("severe", card)
        self.assertIn("Is this vaccine safe given that reaction?", card)
        self.assertIn("severe allergy reported", card)

    def test_footer_keeps_the_nurse_line(self):
        self.assertIn("A nurse confirms the final list", self.html)

    def test_self_contained_no_external_assets(self):
        self.assertNotIn("<script", self.html)
        self.assertNotIn("http://", self.html)
        self.assertNotIn("https://", self.html)

    def test_readiness_and_preflight_panels_render_from_json(self):
        doctor = [{"name": "calle CLI", "status": "pass", "detail": "authenticated"},
                  {"name": "region corridor", "status": "fail", "detail": "blocked"}]
        pre = [{"student_id": "S-041", "guardian_phone": "+14*****0101", "ready_to_run": True, "blockers": []},
               {"student_id": "S-042", "guardian_phone": "+14*****0102", "ready_to_run": False, "blockers": ["x"]}]
        h = board.render(self.roster, doctor, pre)
        self.assertIn('id="sec-readiness"', h)
        self.assertIn('class="check fail"', h)
        self.assertIn("1/2 ready", h)

    def test_render_file_roundtrip(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            rp = Path(d, "roster.json"); rp.write_text(json.dumps(self.roster))
            out = Path(d, "board.html"); board.render_file(str(rp), str(out))
            self.assertTrue(out.read_text().startswith("<!doctype html>"))


if __name__ == "__main__":
    unittest.main()
