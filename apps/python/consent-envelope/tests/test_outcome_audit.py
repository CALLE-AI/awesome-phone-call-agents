import unittest

from outcome_audit import audit_outcome, bot_speech


DISCLOSURE = "This is an automated AI test call."
QUESTION = "Are you available for a brief test?"
CLOSING = "Thank you. The test is complete."


class OutcomeAuditTests(unittest.TestCase):
    def test_compliant_exact_speech_budget(self):
        result = audit_outcome(
            transcript=f"BOT: {DISCLOSURE} BOT: {QUESTION} USER: Yes. BOT: {CLOSING}",
            required_speech=(DISCLOSURE, QUESTION, CLOSING),
            hangup_by="bot",
            attempt_count=1,
            voicemail_detected=False,
        )
        self.assertTrue(result.compliant)
        self.assertEqual(result.unexpected_bot_speech, "")
        self.assertEqual(len(result.policy_sha256), 64)
        self.assertEqual(len(result.transcript_sha256), 64)

    def test_detects_instruction_leak_and_extra_question(self):
        result = audit_outcome(
            transcript=f"BOT: {DISCLOSURE} BOT: Can you hear me? BOT: {QUESTION} BOT: If yes, ask them to confirm. USER: Yes. BOT: {CLOSING}",
            required_speech=(DISCLOSURE, QUESTION, CLOSING),
            hangup_by="bot",
            attempt_count=1,
            voicemail_detected=False,
        )
        self.assertFalse(result.compliant)
        self.assertIn("can you hear me", result.unexpected_bot_speech)
        self.assertIn("ask them to confirm", result.unexpected_bot_speech)

    def test_detects_retry_voicemail_and_non_bot_hangup(self):
        result = audit_outcome(
            transcript=f"BOT: {DISCLOSURE} BOT: {QUESTION} BOT: {CLOSING}",
            required_speech=(DISCLOSURE, QUESTION, CLOSING),
            hangup_by="user",
            attempt_count=2,
            voicemail_detected=True,
        )
        self.assertFalse(result.compliant)
        self.assertEqual(len(result.violations), 3)

    def test_bot_speech_excludes_recipient_words(self):
        self.assertEqual(bot_speech("BOT: Hello USER: Secret words BOT: Goodbye"), "hello goodbye")

    def test_policy_fingerprint_is_stable_and_scope_sensitive(self):
        first = audit_outcome(transcript="BOT: One", required_speech=("One",), hangup_by="bot", attempt_count=1, voicemail_detected=False)
        same = audit_outcome(transcript="BOT: One", required_speech=("One",), hangup_by="bot", attempt_count=1, voicemail_detected=False)
        changed = audit_outcome(transcript="BOT: Two", required_speech=("Two",), hangup_by="bot", attempt_count=1, voicemail_detected=False)
        self.assertEqual(first.policy_sha256, same.policy_sha256)
        self.assertNotEqual(first.policy_sha256, changed.policy_sha256)


if __name__ == "__main__":
    unittest.main()
