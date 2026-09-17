"""Tests for the CALL-E payload and the disposition rules.

The interpretation tests are the important ones. Each asserts that a result
cannot be promoted past a missing precondition.
"""

import unittest

from certa.calle import (
    CONTACT_GATE_KEY,
    DEFAULT_CONFIDENCE_FLOOR,
    CalleError,
    Disposition,
    build_call_payload,
    idempotency_key,
    interpret,
)
from certa.consent import authorize, derive_token
from certa.schema import UNKNOWN, derive_recipient_schema
from certa.tasks import TASK_SPEC_VERSION
from certa.transport import (
    ALLOWED_CREDENTIAL_ORIGINS,
    FixtureTransport,
    LiveTransport,
    TransportError,
)
from certa.types import (
    ConsentReceipt,
    NumberSource,
    Relationship,
    VerificationRequest,
    source_number,
)

A = "+15550100471"
B = "+15550102038"
REQUESTER = "Meridian Lending"


def columns():
    def sel(name, choices, desc=""):
        return {
            "name": name,
            "type": "singleSelect",
            "description": desc,
            "options": {"choices": [{"id": f"c{i}", "name": c} for i, c in enumerate(choices)]},
        }

    return [
        sel("Reached employer", ["Yes", "No", "Unknown"]),
        sel("Employment confirmed", ["Yes", "No", "Unknown"]),
        sel("Title matches", ["Yes", "No", "Unknown"]),
        sel("Declined to answer", ["Yes", "No", "Unknown"]),
    ]


DERIVED = derive_recipient_schema(columns())


def a_contact(request_id="VR-1041", phone=A):
    request = VerificationRequest(
        request_id=request_id,
        applicant_ref="APP-8823",
        employer_name="Cascade Freight Systems",
        applicant_name="Dana Okafor",
        consent=ConsentReceipt("CR-1", "voe-disclosure-2026-01", "2026-09-09T09:00:00Z"),
        sourced=source_number(phone, NumberSource.OFFICIAL_SITE),
    )
    token = derive_token(
        request_id=request_id,
        phone_e164=phone,
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


def a_call(
    *,
    status="completed",
    reached="yes",
    employment="yes",
    title="yes",
    declined="no",
    confidence=0.93,
    evidence=("HR confirmed employment and job title.",),
):
    answers = {}
    if reached is not None:
        answers[CONTACT_GATE_KEY] = reached
    if employment is not None:
        answers["employment_confirmed"] = employment
    if title is not None:
        answers["title_matches"] = title
    if declined is not None:
        answers["declined_to_answer"] = declined
    return {
        "status": status,
        "task_completed": True,
        "completion_confidence": {"score": confidence, "label": "high"},
        "evidence": list(evidence),
        "recipients": [{"structured_result": answers}],
    }


class Payload(unittest.TestCase):
    def test_payload_carries_both_schemas_and_metadata(self):
        payload = build_call_payload(
            [a_contact()], derived=DERIVED, requester_name=REQUESTER
        )
        self.assertIn("recipient_result_schema", payload)
        self.assertIn("result_schema", payload)
        self.assertEqual(payload["metadata"]["request_id"], "VR-1041")
        self.assertEqual(payload["metadata"]["number_sources"], ["official_site"])

    def test_recipients_use_e164_and_optional_routing(self):
        payload = build_call_payload(
            [a_contact()], derived=DERIVED, requester_name=REQUESTER,
            region="US", locale="en-US",
        )
        recipient = payload["recipients"][0]
        self.assertEqual(recipient["phones"], [A])
        self.assertEqual(recipient["region"], "US")
        self.assertEqual(recipient["locale"], "en-US")

    def test_two_numbers_for_one_employer_become_two_recipients(self):
        payload = build_call_payload(
            [a_contact(phone=A), a_contact(phone=B)],
            derived=DERIVED,
            requester_name=REQUESTER,
        )
        self.assertEqual(len(payload["recipients"]), 2)

    def test_mixing_requests_in_one_task_is_refused(self):
        with self.assertRaises(CalleError):
            build_call_payload(
                [a_contact("VR-1041"), a_contact("VR-1042", B)],
                derived=DERIVED,
                requester_name=REQUESTER,
            )

    def test_duplicate_number_is_refused(self):
        with self.assertRaises(CalleError):
            build_call_payload(
                [a_contact(), a_contact()], derived=DERIVED, requester_name=REQUESTER
            )

    def test_task_text_is_embedded(self):
        payload = build_call_payload(
            [a_contact()], derived=DERIVED, requester_name=REQUESTER
        )
        self.assertIn(REQUESTER, payload["task"])
        self.assertIn("Do not ask about salary", payload["task"])


class Idempotency(unittest.TestCase):
    def test_same_intent_yields_the_same_key(self):
        self.assertEqual(idempotency_key([a_contact()]), idempotency_key([a_contact()]))

    def test_different_number_yields_a_different_key(self):
        self.assertNotEqual(
            idempotency_key([a_contact(phone=A)]), idempotency_key([a_contact(phone=B)])
        )

    def test_rerunning_an_unchanged_view_does_not_redial(self):
        transport = FixtureTransport({"create": {"id": "call_1", "status": "queued"}})
        payload = build_call_payload(
            [a_contact()], derived=DERIVED, requester_name=REQUESTER
        )
        key = idempotency_key([a_contact()])
        transport.create_call(payload, idempotency_key=key)
        second = transport.create_call(payload, idempotency_key=key)
        self.assertTrue(second.get("replayed"))
        self.assertEqual(len(transport.created), 1)


class ContactGate(unittest.TestCase):
    """CALL-E issue #341: task_completed can be true with no call placed."""

    def test_task_completed_without_contact_is_never_verified(self):
        call = a_call(reached="no")
        call["task_completed"] = True
        result = interpret(call, DERIVED)
        self.assertEqual(result.disposition, Disposition.EMPLOYER_UNREACHABLE)
        self.assertIn("without evidence a person was reached", result.reason)

    def test_absent_gate_field_is_never_verified(self):
        result = interpret(a_call(reached=None), DERIVED)
        self.assertEqual(result.disposition, Disposition.EMPLOYER_UNREACHABLE)

    def test_unknown_gate_is_never_verified(self):
        result = interpret(a_call(reached="unknown"), DERIVED)
        self.assertNotEqual(result.disposition, Disposition.VERIFIED)


class ProviderReasonMasking(unittest.TestCase):
    def test_malformed_answers_are_masked_in_reasons_not_private_inputs(self):
        phone = "+12025550100"
        for argument, answer_key in (
            ("reached", CONTACT_GATE_KEY),
            ("employment", "employment_confirmed"),
            ("title", "title_matches"),
        ):
            with self.subTest(argument=argument):
                call = a_call(**{argument: phone})
                result = interpret(call, DERIVED)
                self.assertNotIn(phone, result.reason)
                self.assertEqual(result.answers[answer_key], phone)
                self.assertEqual(call["recipients"][0]["structured_result"][answer_key], phone)


class RefusalIsTerminal(unittest.TestCase):
    def test_declined_is_a_final_outcome(self):
        result = interpret(a_call(declined="yes"), DERIVED)
        self.assertEqual(result.disposition, Disposition.DECLINED)

    def test_declined_is_never_retryable(self):
        """Redialling someone who declined is harassment, not persistence."""
        result = interpret(a_call(declined="yes"), DERIVED)
        self.assertFalse(result.retryable)

    def test_declined_outranks_a_confirmed_employment_field(self):
        result = interpret(a_call(declined="yes", employment="yes"), DERIVED)
        self.assertEqual(result.disposition, Disposition.DECLINED)


class FailsClosed(unittest.TestCase):
    def test_non_terminal_status_is_pending(self):
        for status in ("queued", "in_progress"):
            result = interpret(a_call(status=status), DERIVED)
            self.assertEqual(result.disposition, Disposition.PENDING)
            self.assertFalse(result.is_terminal)

    def test_failed_call_is_unreachable_and_retryable(self):
        result = interpret(a_call(status="failed"), DERIVED)
        self.assertEqual(result.disposition, Disposition.EMPLOYER_UNREACHABLE)
        self.assertTrue(result.retryable)

    def test_missing_structured_result_goes_to_review(self):
        call = a_call()
        call["recipients"] = [{"structured_result": None}]
        self.assertEqual(interpret(call, DERIVED).disposition, Disposition.NEEDS_REVIEW)

    def test_low_confidence_goes_to_review(self):
        result = interpret(a_call(confidence=0.4), DERIVED)
        self.assertEqual(result.disposition, Disposition.NEEDS_REVIEW)
        self.assertIn("below", result.reason)

    def test_positive_claim_with_no_evidence_goes_to_review(self):
        result = interpret(a_call(evidence=()), DERIVED)
        self.assertEqual(result.disposition, Disposition.NEEDS_REVIEW)

    def test_contradiction_goes_to_review_not_partial(self):
        result = interpret(a_call(title="no"), DERIVED)
        self.assertEqual(result.disposition, Disposition.NEEDS_REVIEW)
        self.assertIn("contradicted", result.reason)

    def test_unestablished_detail_is_partial(self):
        result = interpret(a_call(title="unknown"), DERIVED)
        self.assertEqual(result.disposition, Disposition.PARTIAL)

    def test_employment_denied_is_not_verified(self):
        result = interpret(a_call(employment="no"), DERIVED)
        self.assertEqual(result.disposition, Disposition.NOT_VERIFIED)

    def test_clean_result_verifies(self):
        result = interpret(a_call(), DERIVED)
        self.assertEqual(result.disposition, Disposition.VERIFIED)
        self.assertEqual(result.confidence, 0.93)

    def test_default_floor_is_not_permissive(self):
        self.assertGreaterEqual(DEFAULT_CONFIDENCE_FLOOR, 0.7)

    def test_no_rule_can_promote_a_result(self):
        """Every gate can only move a disposition toward review."""
        promoted = Disposition.VERIFIED
        for call in (
            a_call(reached="no"),
            a_call(declined="yes"),
            a_call(confidence=0.1),
            a_call(evidence=()),
            a_call(title="no"),
            a_call(status="failed"),
        ):
            self.assertNotEqual(interpret(call, DERIVED).disposition, promoted)


class CredentialBoundary(unittest.TestCase):
    """An API key may only travel to CALL-E's documented origin."""

    def test_arbitrary_base_url_is_refused(self):
        with self.assertRaises(TransportError) as ctx:
            LiveTransport("iams_live_example", base_url="https://evil.example.com")
        self.assertIn("refusing to send a CALL-E API key", str(ctx.exception))

    def test_plain_http_is_refused(self):
        with self.assertRaises(TransportError):
            LiveTransport("iams_live_example", base_url="http://api.heycall-e.com")

    def test_missing_key_is_refused(self):
        with self.assertRaises(TransportError):
            LiveTransport("")

    def test_documented_origin_is_the_only_allowance(self):
        self.assertEqual(ALLOWED_CREDENTIAL_ORIGINS, frozenset({"api.heycall-e.com"}))


class FixtureReplay(unittest.TestCase):
    def test_poll_sequence_advances_then_holds(self):
        transport = FixtureTransport(
            {
                "create": {"id": "call_1", "status": "queued"},
                "poll": [{"status": "in_progress"}, a_call()],
            }
        )
        self.assertEqual(transport.get_call("call_1")["status"], "in_progress")
        self.assertEqual(transport.get_call("call_1")["status"], "completed")
        self.assertEqual(transport.get_call("call_1")["status"], "completed")

    def test_fixture_transport_places_no_calls(self):
        transport = FixtureTransport({"create": {"id": "call_1"}})
        self.assertFalse(hasattr(transport, "api_key"))


class GatesThatWereSkippable(unittest.TestCase):
    """Two ways a result reached VERIFIED without being checked.

    Both were raised in review on PR #552 and both were real: a call with no
    `completion_confidence` skipped the floor entirely, and a value the
    schema does not define was neither a contradiction nor an unknown, so it
    passed both of those checks and counted as an established fact.
    """

    def call(self, answers, confidence=0.93):
        body = {
            "status": "completed",
            "evidence": ["a person confirmed employment"],
            "recipients": [{"structured_result": answers}],
        }
        if confidence is not None:
            body["completion_confidence"] = {"score": confidence}
        return interpret(body, DERIVED, confidence_floor=DEFAULT_CONFIDENCE_FLOOR)

    BASE = {"reached_employer": "yes", "employment_confirmed": "yes"}

    def test_a_missing_confidence_is_not_a_passed_confidence(self):
        result = self.call({**self.BASE, "title_matches": "yes"}, confidence=None)
        self.assertEqual(result.disposition, Disposition.NEEDS_REVIEW)
        self.assertIn("no completion confidence", result.reason)

    def test_a_present_confidence_still_verifies(self):
        result = self.call({**self.BASE, "title_matches": "yes"}, confidence=0.93)
        self.assertEqual(result.disposition, Disposition.VERIFIED)

    def test_a_value_outside_the_schema_is_not_a_fact(self):
        for bad in ("probably", "YES", "y", "true", ""):
            result = self.call({**self.BASE, "title_matches": bad})
            self.assertEqual(
                result.disposition, Disposition.NEEDS_REVIEW,
                msg=f"{bad!r} was treated as established",
            )

    def test_the_off_schema_value_is_named_in_the_reason(self):
        result = self.call({**self.BASE, "title_matches": "probably"})
        self.assertIn("title_matches", result.reason)
        self.assertIn("probably", result.reason)

    def test_unknown_is_still_partial_not_review(self):
        """`unknown` is a defined answer: unestablished, not suspicious."""
        result = self.call({**self.BASE, "title_matches": UNKNOWN})
        self.assertEqual(result.disposition, Disposition.PARTIAL)


if __name__ == "__main__":
    unittest.main()
