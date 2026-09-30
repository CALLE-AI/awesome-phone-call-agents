"""Tests for the spoken task text.

The person who answers did not apply for anything. These tests assert the text
stays inside what consent covers, and that no prohibition can be quietly
dropped during an edit.
"""

import unittest

from certa.consent import authorize, derive_token
from certa.schema import CONTACT_GATE_KEY
from certa.tasks import (
    PERMITTED_QUESTIONS,
    PROHIBITIONS,
    TASK_SPEC_VERSION,
    TaskError,
    build_task,
    prohibitions_present,
)
from certa.types import (
    ConsentReceipt,
    NumberSource,
    Relationship,
    VerificationRequest,
    source_number,
)

FICTIONAL = "+15550100471"
REQUESTER = "Meridian Lending"


def flat(text: str) -> str:
    """Collapse wrapping so phrase assertions test content, not line breaks."""
    return " ".join(text.split())


def a_contact(applicant_name: str = "Dana Okafor"):
    request = VerificationRequest(
        request_id="VR-1041",
        applicant_ref="APP-8823",
        employer_name="Cascade Freight Systems",
        applicant_name=applicant_name,
        consent=ConsentReceipt("CR-1", "voe-disclosure-2026-01", "2026-09-09T09:00:00Z"),
        sourced=source_number(FICTIONAL, NumberSource.OFFICIAL_SITE),
    )
    token = derive_token(
        request_id=request.request_id,
        phone_e164=FICTIONAL,
        relationship=Relationship.EMPLOYER,
        task_spec_version=TASK_SPEC_VERSION,
        consent_receipt_id="CR-1",
    )
    return authorize(
        request,
        relationship=Relationship.EMPLOYER,
        task_spec_version=TASK_SPEC_VERSION,
        presented_token=token,
    )


class Disclosure(unittest.TestCase):
    def test_discloses_automated_before_any_question(self):
        task = build_task(a_contact(), requester_name=REQUESTER)
        first = task.index("automated employment verification call")
        for question_marker in ("Establish only", "Ask to reach"):
            self.assertLess(
                first, task.index(question_marker),
                "disclosure must come before anything is asked",
            )

    def test_names_the_requesting_organisation(self):
        task = build_task(a_contact(), requester_name=REQUESTER)
        self.assertIn(REQUESTER, task)

    def test_states_that_consent_was_given(self):
        task = build_task(a_contact(), requester_name=REQUESTER)
        self.assertIn("written consent", task)

    def test_undisclosed_requester_is_refused(self):
        with self.assertRaises(TaskError) as ctx:
            build_task(a_contact(), requester_name="   ")
        self.assertIn("pretexting", str(ctx.exception))

    def test_unnamed_applicant_is_refused(self):
        with self.assertRaises(TaskError):
            build_task(a_contact(applicant_name=""), requester_name=REQUESTER)


class Prohibitions(unittest.TestCase):
    """Each prohibition must survive every edit to the text."""

    def test_every_prohibition_appears_verbatim(self):
        task = build_task(a_contact(), requester_name=REQUESTER)
        self.assertEqual(prohibitions_present(task), [])
        # ...and survives wrapping, which is how the model actually reads it.
        self.assertEqual(
            [p for p in PROHIBITIONS if flat(p) not in flat(task)], []
        )

    def test_salary_is_explicitly_forbidden(self):
        task = build_task(a_contact(), requester_name=REQUESTER)
        self.assertIn("Do not ask about salary", task)

    def test_no_permitted_question_asks_about_pay(self):
        for question in PERMITTED_QUESTIONS:
            for word in ("salary", "pay", "compensation", "wage", "income", "bonus"):
                self.assertNotIn(word, question.lower())

    def test_permitted_questions_are_exactly_three(self):
        self.assertEqual(len(PERMITTED_QUESTIONS), 3)

    def test_prohibition_list_is_not_empty_and_is_rendered(self):
        self.assertGreaterEqual(len(PROHIBITIONS), 8)
        task = build_task(a_contact(), requester_name=REQUESTER)
        self.assertIn("Do not:", task)


class RefusalAndVoicemail(unittest.TestCase):
    def test_refusal_is_a_complete_outcome(self):
        task = flat(build_task(a_contact(), requester_name=REQUESTER))
        self.assertIn("complete and acceptable outcome", task)
        self.assertIn("not a failure to work around", task)

    def test_no_details_left_on_voicemail(self):
        task = flat(build_task(a_contact(), requester_name=REQUESTER))
        self.assertIn("voicemail", task)
        self.assertIn("without leaving details", task)

    def test_instructs_reporting_not_reached_rather_than_guessing(self):
        task = flat(build_task(a_contact(), requester_name=REQUESTER))
        self.assertIn("employer was not reached", task)


class IvrHandling(unittest.TestCase):
    def test_task_instructs_menu_navigation(self):
        task = flat(build_task(a_contact(), requester_name=REQUESTER))
        self.assertIn("automated menu", task)
        self.assertIn("keypad", task)

    def test_task_asks_for_the_right_department(self):
        task = flat(build_task(a_contact(), requester_name=REQUESTER)).lower()
        for department in ("human resources", "payroll"):
            self.assertIn(department, task)


class SpecVersioning(unittest.TestCase):
    """The version is the consent-revocation mechanism, not a label."""

    def test_version_is_set_and_slug_shaped(self):
        self.assertTrue(TASK_SPEC_VERSION)
        self.assertRegex(TASK_SPEC_VERSION, r"^[a-z0-9-]+$")

    def test_contact_carries_the_version_it_was_authorised_under(self):
        self.assertEqual(a_contact().task_spec_version, TASK_SPEC_VERSION)

    def test_contact_gate_key_is_reachable_from_the_task_intent(self):
        """The text must give the model grounds to answer the gate honestly."""
        task = flat(build_task(a_contact(), requester_name=REQUESTER))
        self.assertIn("not reached", task)
        self.assertEqual(CONTACT_GATE_KEY, "reached_employer")


class NoLeakage(unittest.TestCase):
    def test_task_never_contains_a_raw_phone_number(self):
        task = build_task(a_contact(), requester_name=REQUESTER)
        self.assertNotIn(FICTIONAL, task)
        self.assertNotIn(FICTIONAL.lstrip("+"), task)

    def test_task_does_not_contain_the_internal_reference(self):
        """The employer has no need for the lender's internal application id."""
        task = build_task(a_contact(), requester_name=REQUESTER)
        self.assertNotIn("APP-8823", task)


if __name__ == "__main__":
    unittest.main()
