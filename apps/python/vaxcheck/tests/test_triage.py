import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from vaxcheck.triage import (
    CLEARED, DECLINED, NURSE_REVIEW, PRIVATE_PROVIDER, UNREACHABLE, triage_record,
)

CLEAN = {
    "reached_guardian": "yes", "identity_confirmed": "yes", "consent": "granted",
    "route": "school_session", "prior_dose_reported": "no", "allergy_reported": "none",
    "unwell_today": "no", "callback_requested": "no", "guardian_questions": "",
}


def t(**over):
    return triage_record({**CLEAN, **over}, task_completed=True, confidence=0.95)


class TestTriage(unittest.TestCase):
    def test_clean_consent_clears(self):
        self.assertEqual(t().disposition, CLEARED)
        self.assertEqual(t().reasons, [])

    def test_severe_allergy_never_clears(self):
        r = t(allergy_reported="severe")
        self.assertEqual(r.disposition, NURSE_REVIEW)
        self.assertIn("severe allergy reported", r.reasons)

    def test_unsure_answers_route_to_human(self):
        for field in ("allergy_reported", "prior_dose_reported", "unwell_today"):
            self.assertEqual(t(**{field: "unsure"}).disposition, NURSE_REVIEW, field)

    def test_low_confidence_blocks_clearance(self):
        r = triage_record(CLEAN, task_completed=True, confidence=0.5)
        self.assertEqual(r.disposition, NURSE_REVIEW)

    def test_missing_confidence_blocks_clearance(self):
        self.assertEqual(
            triage_record(CLEAN, task_completed=True, confidence=None).disposition,
            NURSE_REVIEW,
        )

    def test_task_not_completed_blocks_clearance(self):
        self.assertEqual(
            triage_record(CLEAN, task_completed=False, confidence=0.99).disposition,
            NURSE_REVIEW,
        )

    def test_unconfirmed_identity_blocks_clearance(self):
        self.assertEqual(t(identity_confirmed="unknown").disposition, NURSE_REVIEW)

    def test_private_provider_wins_over_declined_consent(self):
        # Choosing your own doctor declines the *school session* but is not a refusal.
        r = t(consent="declined", route="private_provider")
        self.assertEqual(r.disposition, PRIVATE_PROVIDER)

    def test_explicit_decline(self):
        self.assertEqual(t(consent="declined", route="decline").disposition, DECLINED)

    def test_prior_dose_goes_to_nurse_even_when_clean(self):
        self.assertEqual(t(prior_dose_reported="yes").disposition, NURSE_REVIEW)

    def test_unanswered_question_blocks_clearance(self):
        self.assertEqual(t(guardian_questions="Is it safe?").disposition, NURSE_REVIEW)

    def test_callback_request_blocks_clearance(self):
        self.assertEqual(t(callback_requested="yes").disposition, NURSE_REVIEW)

    def test_not_reached_is_unreachable_not_consent(self):
        r = triage_record({**CLEAN, "reached_guardian": "no"}, task_completed=True, confidence=0.9)
        self.assertEqual(r.disposition, UNREACHABLE)

    def test_empty_result_is_unreachable(self):
        for empty in (None, {}, "nonsense", []):
            self.assertEqual(triage_record(empty).disposition, UNREACHABLE)

    def test_silence_is_never_consent(self):
        # Every degraded input must land somewhere that is not CLEARED.
        for bad in (None, {}, {"reached_guardian": "unknown"}, {"reached_guardian": "yes"}):
            self.assertNotEqual(triage_record(bad).disposition, CLEARED)


if __name__ == "__main__":
    unittest.main()
