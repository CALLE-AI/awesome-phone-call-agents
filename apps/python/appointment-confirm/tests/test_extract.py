import json
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from appointment_confirm.extract import extract_from_turns
from appointment_confirm.schema import load_intake

APP = Path(__file__).resolve().parents[1]
FIXTURES = APP / "fixtures"


class ExtractorTests(unittest.TestCase):
    def setUp(self):
        self.intake = load_intake(FIXTURES / "sample_appointment.json")

    def _run(self, name: str):
        fixture = json.loads((FIXTURES / name).read_text())
        got = extract_from_turns(fixture["transcript_turns"], self.intake)
        self.assertEqual(got, fixture["expected_structured_result"], name)
        return got

    def test_confirm_yes(self):
        self._run("conversation_confirm_yes.json")

    def test_reschedule(self):
        self._run("conversation_reschedule.json")

    def test_decline(self):
        self._run("conversation_decline.json")

    def test_voicemail(self):
        self._run("conversation_voicemail.json")

    def test_ambiguous(self):
        self._run("conversation_ambiguous.json")


if __name__ == "__main__":
    unittest.main()
