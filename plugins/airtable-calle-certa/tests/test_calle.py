"""Tests for the CALL-E payload and the disposition rules.

The interpretation tests are the important ones. Each asserts that a result
cannot be promoted past a missing precondition.
"""

import unittest

from certa.calle import (
    CONTACT_GATE_KEY,
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
        "result_status": "available" if status == "completed" else "not_applicable" if status in ("failed", "canceled") else "pending",
        "call_outcome": "completed" if status == "completed" else None,
        "result": {**answers, "evidence_quote": evidence[0] if evidence else ""},
        "transcript": [{"speaker": "user", "text": text} for text in evidence],
    }


class Payload(unittest.TestCase):
    def test_payload_carries_one_schema_and_metadata(self):
        payload = build_call_payload(
            [a_contact()], derived=DERIVED, requester_name=REQUESTER
        )
        self.assertNotIn("recipient_result_schema", payload)
        self.assertIn("result_schema", payload)
        self.assertEqual(payload["metadata"]["request_id"], "VR-1041")
        self.assertEqual(payload["metadata"]["number_sources"], ["official_site"])

    def test_recipients_use_e164_and_optional_routing(self):
        payload = build_call_payload(
            [a_contact()], derived=DERIVED, requester_name=REQUESTER,
            region="US", locale="en-US",
        )
        recipient = payload
        self.assertEqual(recipient["phone"], A)
        self.assertEqual(recipient["region"], "US")
        self.assertEqual(recipient["locale"], "en-US")

    def test_multiple_contacts_are_refused_before_submission(self):
        with self.assertRaisesRegex(CalleError, "exactly one"):
            build_call_payload([a_contact(phone=A), a_contact(phone=B)],
                               derived=DERIVED, requester_name=REQUESTER)

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


class ContradictoryEvidence(unittest.TestCase):
    def test_positive_employment_with_denial_quote_requires_review(self):
        for quote in ("No, this person has never worked here.", "They don't work here.", "I am unsure."):
            with self.subTest(quote=quote):
                self.assertEqual(interpret(a_call(evidence=(quote,)), DERIVED).disposition,
                                 Disposition.NEEDS_REVIEW)

    def test_a_supported_negative_employment_answer_remains_not_verified(self):
        self.assertEqual(interpret(a_call(employment="no", evidence=("No, this person has never worked here.",)), DERIVED).disposition,
                         Disposition.NOT_VERIFIED)


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
        self.assertEqual(result.disposition, Disposition.NEEDS_REVIEW)

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
                self.assertEqual(call["result"][answer_key], phone)


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

    def test_failed_call_requires_review_before_any_retry(self):
        result = interpret(a_call(status="failed"), DERIVED)
        self.assertEqual(result.disposition, Disposition.NEEDS_REVIEW)
        self.assertFalse(result.retryable)

    def test_missing_structured_result_goes_to_review(self):
        call = a_call()
        call["result"] = None
        self.assertEqual(interpret(call, DERIVED).disposition, Disposition.NEEDS_REVIEW)

    def test_an_ungrounded_quote_goes_to_review(self):
        call = a_call()
        call["result"]["evidence_quote"] = "invented confirmation"
        self.assertEqual(interpret(call, DERIVED).disposition, Disposition.NEEDS_REVIEW)

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
        self.assertTrue(result.evidence)

    def test_no_rule_can_promote_a_result(self):
        """Every gate can only move a disposition toward review."""
        promoted = Disposition.VERIFIED
        for call in (
            a_call(reached="no"),
            a_call(declined="yes"),
            a_call(reached="unknown"),
            a_call(evidence=()),
            a_call(title="no"),
            a_call(status="failed"),
        ):
            self.assertNotEqual(interpret(call, DERIVED).disposition, promoted)

    def test_execution_completion_does_not_end_result_waiting(self):
        call = a_call()
        call["result_status"] = "pending"
        self.assertEqual(interpret(call, DERIVED).disposition, Disposition.PENDING)

    def test_final_unavailable_or_empty_result_needs_review(self):
        for readiness, result in [("available", {}), ("unavailable", None), ("not_applicable", None)]:
            call = {**a_call(), "result_status": readiness, "result": result, "error": None}
            verdict = interpret(call, DERIVED)
            self.assertEqual(verdict.disposition, Disposition.NEEDS_REVIEW)
            self.assertFalse(verdict.retryable)

    def test_final_call_outcomes_do_not_require_business_answers(self):
        for outcome, expected in [("no_answer", Disposition.EMPLOYER_UNREACHABLE), ("busy", Disposition.EMPLOYER_UNREACHABLE), ("declined", Disposition.DECLINED)]:
            call = {**a_call(), "call_outcome": outcome, "result_status": "unavailable", "result": None}
            self.assertEqual(interpret(call, DERIVED).disposition, expected)

    def test_malformed_business_values_never_verify(self):
        for value in [None, {}, [], True, 7]:
            self.assertEqual(interpret(a_call(title=value), DERIVED).disposition, Disposition.NEEDS_REVIEW)



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

    def test_live_transport_uses_v2_resource_ids_for_every_call_endpoint(self):
        transport = LiveTransport("fake-key")
        requests = []
        transport._request = lambda method, path, **kwargs: requests.append((method, path, kwargs)) or {}
        transport.create_call({"phone": A}, idempotency_key="fixed-key")
        transport.get_call("call/a")
        transport.list_events("call/a")
        self.assertEqual([(method, path) for method, path, _ in requests], [
            ("POST", "/v2/calls"), ("GET", "/v2/calls/call%2Fa"), ("GET", "/v2/calls/call%2Fa/events")])
        self.assertEqual(requests[0][2]["headers"]["Idempotency-Key"], "fixed-key")
        self.assertEqual(transport.timeout, 30)



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


class AnswerValidation(unittest.TestCase):
    def call(self, answers):
        body = a_call()
        body["result"].update(answers)
        return interpret(body, DERIVED)

    BASE = {"reached_employer": "yes", "employment_confirmed": "yes"}

    def test_a_bot_quote_cannot_support_verification(self):
        body = a_call()
        body["transcript"][0]["speaker"] = "bot"
        self.assertEqual(interpret(body, DERIVED).disposition, Disposition.NEEDS_REVIEW)

    def test_ready_business_answers_verify_without_legacy_confidence(self):
        self.assertEqual(self.call({**self.BASE, "title_matches": "yes"}).disposition, Disposition.VERIFIED)

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
