import unittest
from outcome_audit import audit_outcome


class EvidenceValidationTests(unittest.TestCase):
    def check_invalid(self, **overrides):
        values = dict(transcript="BOT: Hello", required_speech=("Hello",),
                      hangup_by="bot", attempt_count=1, voicemail_detected=False)
        values.update(overrides)
        with self.assertRaises(ValueError):
            audit_outcome(**values)

    def test_empty_evidence(self):
        self.check_invalid(transcript="")
        self.check_invalid(required_speech=())
        self.check_invalid(required_speech=("!!!",))

    def test_no_truthy_string_coercion(self):
        self.check_invalid(voicemail_detected="false")

    def test_attempt_count_is_not_boolean(self):
        self.check_invalid(attempt_count=True)
        self.check_invalid(attempt_count="1")
