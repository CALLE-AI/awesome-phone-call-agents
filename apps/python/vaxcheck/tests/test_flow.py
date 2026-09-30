"""End-to-end: roster file -> fixture replay -> triaged roster."""

import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vaxcheck import report
from vaxcheck.classify import records_from_calls
from vaxcheck.mock_client import build_calls, load_fixture
from vaxcheck.roster import RosterError, load
from vaxcheck.triage import CLEARED, DECLINED, NURSE_REVIEW, PRIVATE_PROVIDER, UNREACHABLE

ROSTER = ROOT / "fixtures" / "sample_roster.json"
FIXTURES = [
    "conversation_consent_school.json", "conversation_private_provider.json",
    "conversation_allergy_severe.json", "conversation_decline.json",
    "conversation_unsure.json", "conversation_voicemail.json",
]


class TestFlow(unittest.TestCase):
    def setUp(self):
        self.session, self.students = load(ROSTER)
        pairs = build_calls(self.students, [load_fixture(f) for f in FIXTURES])
        self.records = records_from_calls(pairs)

    def test_every_student_gets_exactly_one_record(self):
        self.assertEqual(len(self.records), len(self.students))
        self.assertEqual(
            [r.student_id for r in self.records], [s.student_id for s in self.students]
        )

    def test_each_fixture_lands_on_its_intended_disposition(self):
        got = {r.student_id: r.triage.disposition for r in self.records}
        self.assertEqual(got["S-041"], CLEARED)
        self.assertEqual(got["S-042"], PRIVATE_PROVIDER)
        self.assertEqual(got["S-043"], NURSE_REVIEW)
        self.assertEqual(got["S-044"], DECLINED)
        self.assertEqual(got["S-045"], NURSE_REVIEW)
        self.assertEqual(got["S-046"], UNREACHABLE)

    def test_only_one_student_clears(self):
        self.assertEqual(sum(r.triage.disposition == CLEARED for r in self.records), 1)

    def test_no_raw_phone_number_anywhere_in_output(self):
        blob = report.dumps(self.records, self.session) + report.render(
            self.records, self.session
        )
        for student in self.students:
            self.assertNotIn(student.guardian_phone, blob)

    def test_json_report_counts_match_records(self):
        payload = json.loads(report.dumps(self.records, self.session))
        self.assertEqual(payload["total"], len(self.records))
        self.assertEqual(sum(payload["counts"].values()), len(self.records))

    def test_text_report_leads_with_review_queue(self):
        text = report.render(self.records, self.session)
        self.assertLess(text.index("NURSE REVIEW REQUIRED"), text.index("CLEARED FOR SESSION"))

    def test_roster_rejects_duplicate_student_ids(self):
        import tempfile
        raw = json.loads(ROSTER.read_text())
        raw["students"].append(dict(raw["students"][0]))
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump(raw, fh); path = fh.name
        with self.assertRaises(RosterError):
            load(path)

    def test_roster_rejects_bad_phone(self):
        import tempfile
        raw = json.loads(ROSTER.read_text())
        raw["students"][0]["guardian_phone"] = "415-555-0101"
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump(raw, fh); path = fh.name
        with self.assertRaises(RosterError):
            load(path)


if __name__ == "__main__":
    unittest.main()
