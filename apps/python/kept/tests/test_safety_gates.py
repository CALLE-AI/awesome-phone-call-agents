"""The gates that stand between a configuration mistake and a stranger's phone.

Each test here pins one refusal that has no business being a judgement call: an
undialable number, a credential pointed at the wrong host, a recipient nobody
authorised, a result that cannot be tied to the call that produced it, and an
outcome nobody can read.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from tests.conftest import at, make_customer, make_invoice

from kept.calls.port import (
    CallPlacementError,
    PlacedCall,
    idempotency_key,
    payload_digest,
    task_digest,
)
from kept.capture import CallBinding, CaptureVerdict, PromiseCapture, RejectionReason
from kept.config import (
    OFFICIAL_BASE_URL,
    Organisation,
    Policy,
    UnauthorizedRecipientsError,
    UntrustedBaseUrlError,
    load_authorized_recipients,
    load_credentials,
)
from kept.models import CallCycle, CallTarget, Customer, SuppressionReason, is_e164, redact_phone_like
from kept.policy import CallPlanner
from kept.store import AccountBook
from tests.test_capture import _GOOD_ANSWER, _placed, binding

NOW = at("2026-08-24")


@pytest.mark.parametrize(
    "phone",
    ["+12025550101", "+442079460123", "+447700900123"],
)
def test_full_international_numbers_are_accepted(phone: str) -> None:
    assert is_e164(phone) is True


@pytest.mark.parametrize(
    "phone",
    [
        "+1 202 555 0101",
        "+1-202-555-0101",
        "2025550101",
        "+0155010101",
        "+1202",
        "+12025550101x22",
        "+120255501011234567",
        "",
    ],
)
def test_a_leading_plus_is_not_enough_to_be_dialable(phone: str) -> None:
    assert is_e164(phone) is False
    with pytest.raises(ValueError, match="E.164"):
        make_customer(phones=(phone,))


def test_the_creditor_callback_number_is_held_to_the_same_standard() -> None:
    with pytest.raises(ValueError, match="E.164"):
        Organisation(name="Northgate Supply", callback_number="+1 202 555 0199")


def test_a_production_key_is_only_ever_sent_to_the_official_api() -> None:
    environ = {"CALLE_API_KEY": "test-key", "CALLE_BASE_URL": "https://evil.example.com"}

    with pytest.raises(UntrustedBaseUrlError, match=OFFICIAL_BASE_URL):
        load_credentials(environ)


def test_the_official_origin_may_be_stated_explicitly() -> None:
    environ = {"CALLE_API_KEY": "test-key", "CALLE_BASE_URL": f"{OFFICIAL_BASE_URL}/"}

    assert load_credentials(environ).base_url == OFFICIAL_BASE_URL


def test_a_missing_authorization_file_refuses_the_run(tmp_path) -> None:
    with pytest.raises(UnauthorizedRecipientsError, match="authorized_recipients.txt"):
        load_authorized_recipients(tmp_path)


def test_an_authorization_file_of_comments_authorises_nobody(tmp_path) -> None:
    (tmp_path / "authorized_recipients.txt").write_text("# nobody\n\n", encoding="utf-8")

    with pytest.raises(UnauthorizedRecipientsError, match="authorises nobody"):
        load_authorized_recipients(tmp_path)


def test_authorization_must_name_an_exact_dialable_number(tmp_path) -> None:
    (tmp_path / "authorized_recipients.txt").write_text("+1 202 555 0101\n", encoding="utf-8")

    with pytest.raises(UnauthorizedRecipientsError, match="not E.164"):
        load_authorized_recipients(tmp_path)


def test_comments_and_blank_lines_are_stripped_from_the_allow_list(tmp_path) -> None:
    (tmp_path / "authorized_recipients.txt").write_text(
        "# the operator's own phone\n+12025550101  # opted in\n\n", encoding="utf-8"
    )

    assert load_authorized_recipients(tmp_path) == frozenset({"+12025550101"})


def _book(customer: Customer) -> AccountBook:
    invoice = make_invoice(customer_id=customer.id, due="2026-08-01")
    return AccountBook(customers={customer.id: customer}, invoices=[invoice], payments=[])


def test_an_unauthorized_number_is_suppressed_by_name(policy: Policy) -> None:
    customer = make_customer(phones=("+12025550101",))
    planner = CallPlanner(policy=policy, authorized_phones=frozenset({"+12025550150"}))

    plan = planner.plan(_book(customer), NOW, budget=5)

    assert plan.targets == ()
    assert [s.reason for s in plan.suppressions] == [SuppressionReason.NOT_AUTHORIZED]


def test_the_same_number_on_the_allow_list_is_callable(policy: Policy) -> None:
    customer = make_customer(phones=("+12025550101",))
    planner = CallPlanner(policy=policy, authorized_phones=frozenset({"+12025550101"}))

    plan = planner.plan(_book(customer), NOW, budget=5)

    assert [t.invoice.customer_id for t in plan.targets] == [customer.id]


def test_do_not_call_still_outranks_an_authorised_number(policy: Policy) -> None:
    customer = make_customer(phones=("+12025550101",), do_not_call=True)
    planner = CallPlanner(policy=policy, authorized_phones=frozenset({"+12025550101"}))

    plan = planner.plan(_book(customer), NOW, budget=5)

    assert [s.reason for s in plan.suppressions] == [SuppressionReason.DO_NOT_CALL]


def _target() -> CallTarget:
    return CallTarget(
        invoice=make_invoice(),
        customer=make_customer(),
        cycle=CallCycle.FIRST_CONTACT,
        outstanding_minor=125_000,
        broken_promise_count=0,
    )


def _capture(policy: Policy, placed: PlacedCall, bound: CallBinding):
    return PromiseCapture(policy=policy).capture(placed, _target(), NOW, bound)


_OMISSIONS = {
    "task": {"task": ""},
    "recipients": {"phones": ()},
    "metadata": {"metadata": {}},
    "one metadata key": {"metadata": {"invoice_id": "INV-1001", "cycle": "first_contact"}},
}


def _omitting(fields: dict) -> PlacedCall:
    """A terminal call that fails to echo something CALL-E always echoes."""
    return replace(_placed(dict(_GOOD_ANSWER)), **fields)


def _unfinished(answer: dict) -> PlacedCall:
    placed = _placed(answer)
    return replace(placed, task_completed=False)


def test_a_result_for_another_call_records_nothing(policy: Policy) -> None:
    result = _capture(policy, _placed(dict(_GOOD_ANSWER)), binding(call_id="call_someone_else"))

    assert result.verdict is CaptureVerdict.NO_RECORD
    assert result.rejection is RejectionReason.RESULT_NOT_BOUND


def test_a_result_for_another_invoice_records_nothing(policy: Policy) -> None:
    other = {"invoice_id": "INV-9999", "customer_id": "CUS-01", "cycle": "first_contact"}

    result = _capture(policy, _placed(dict(_GOOD_ANSWER)), binding(metadata=other))

    assert result.rejection is RejectionReason.RESULT_NOT_BOUND


def test_a_result_from_a_different_recipient_records_nothing(policy: Policy) -> None:
    result = _capture(policy, _placed(dict(_GOOD_ANSWER)), binding(phone="+12025550150"))

    assert result.rejection is RejectionReason.RESULT_NOT_BOUND


def test_a_result_for_a_different_task_records_nothing(policy: Policy) -> None:
    other = task_digest("Ask about something else.")

    result = _capture(policy, _placed(dict(_GOOD_ANSWER)), binding(task_digest=other))

    assert result.rejection is RejectionReason.RESULT_NOT_BOUND


@pytest.mark.parametrize("omission", list(_OMISSIONS.values()), ids=list(_OMISSIONS))
def test_a_result_that_omits_what_was_sent_is_not_trusted(policy: Policy, omission: dict) -> None:
    """The echo is required, not optional; nothing absent is assumed to match."""
    result = _capture(policy, _omitting(omission), binding())

    assert result.rejection is RejectionReason.RESULT_NOT_BOUND


def test_a_finished_call_that_did_not_finish_the_job_records_nothing(policy: Policy) -> None:
    """CALL-E reports "the call ended" and "the job was done" separately."""
    result = _capture(policy, _unfinished(dict(_GOOD_ANSWER)), binding())

    assert result.rejection is RejectionReason.CALL_NOT_COMPLETED


def test_a_dispute_from_the_wrong_person_is_not_a_dispute(policy: Policy) -> None:
    answer = {**_GOOD_ANSWER, "dispute_raised": "yes", "right_party_reached": "no"}

    result = _capture(policy, _placed(answer), binding())

    assert result.verdict is CaptureVerdict.NO_RECORD
    assert result.rejection is RejectionReason.WRONG_PARTY


def test_a_phone_number_spoken_on_the_call_never_reaches_the_record(policy: Policy) -> None:
    answer = {**_GOOD_ANSWER, "evidence_quote": "Call our AP desk on +1 202 555 0177 to confirm."}

    result = _capture(policy, _placed(answer), binding())

    assert result.promise is not None
    assert "555" not in result.promise.evidence
    assert "***77" in result.promise.evidence


def test_amounts_and_dates_survive_redaction_untouched() -> None:
    text = "We'll send 1,250.00 on 2026-08-31, reference 4800."

    assert redact_phone_like(text) == text


def test_a_changed_payload_cannot_reuse_a_spent_idempotency_key() -> None:
    common = {
        "phone": "+12025550101",
        "region": "US",
        "locale": "en-US",
        "result_schema": {"type": "object"},
        "metadata": {"invoice_id": "INV-1001"},
    }
    first = payload_digest(task="Ask about INV-1001.", **common)
    second = payload_digest(task="Ask about INV-1002.", **common)

    assert first != second
    assert idempotency_key(
        invoice_id="INV-1001", cycle=CallCycle.FIRST_CONTACT, attempt=0, payload_digest=first
    ) != idempotency_key(
        invoice_id="INV-1001", cycle=CallCycle.FIRST_CONTACT, attempt=0, payload_digest=second
    )


def test_the_run_id_is_left_out_so_a_crashed_run_still_deduplicates() -> None:
    common = {
        "task": "Ask about INV-1001.",
        "phone": "+12025550101",
        "region": "US",
        "locale": "en-US",
        "result_schema": {"type": "object"},
    }
    first = payload_digest(metadata={"run_id": "run_a", "invoice_id": "INV-1001"}, **common)
    second = payload_digest(metadata={"run_id": "run_b", "invoice_id": "INV-1001"}, **common)

    assert first == second


def test_a_timeout_is_ambiguous_and_a_rejected_request_is_not() -> None:
    assert CallPlacementError("no answer from the API", code="timeout").is_ambiguous is True
    assert CallPlacementError("dropped", code="connection_error").is_ambiguous is True
    assert CallPlacementError("bad schema", code="result_schema_invalid").is_ambiguous is False
