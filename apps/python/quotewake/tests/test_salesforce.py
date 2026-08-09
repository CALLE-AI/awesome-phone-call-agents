"""Tests for Salesforce Contact opt-out field configuration."""

from __future__ import annotations

import unittest
from unittest.mock import Mock

from quotewake_salesforce.domain.models import (
    QuoteCandidate,
    SelectionDecision,
    SelectionReason,
    SelectionResult,
)
from quotewake_salesforce.domain.selection import validate_callable_contact
from quotewake_salesforce.salesforce.client import SalesforceSchemaError
from quotewake_salesforce.salesforce.quotes import REQUIRED_QUOTE_FIELDS, QuoteRepository


OPPORTUNITY_ID = "006000000000001"
CONTACT_ID = "003000000000001"
OPT_OUT_FIELD = "QuoteWake_Do_Not_Call__c"


def _description(field_names: set[str]) -> dict[str, list[dict[str, str]]]:
    return {"fields": [{"name": name} for name in sorted(field_names)]}


def _client(contact_fields: set[str], contact_record: dict[str, object]) -> Mock:
    client = Mock()
    client.describe.side_effect = [
        _description(REQUIRED_QUOTE_FIELDS),
        _description(contact_fields),
    ]
    client.query.return_value = [contact_record]
    return client


def _contact_record(**contact_values: object) -> dict[str, object]:
    contact = {
        "Name": "Test Contact",
        "Phone": "+14155550121",
        "MobilePhone": None,
        **contact_values,
    }
    return {
        "OpportunityId": OPPORTUNITY_ID,
        "ContactId": CONTACT_ID,
        "IsPrimary": True,
        "Contact": contact,
    }


def _ready_result() -> SelectionResult:
    quote = QuoteCandidate(
        quote_id="0Q0000000000001",
        quote_name="Q-001",
        quote_status="Presented",
        amount=None,
        currency_code=None,
        expiration_date=None,
        opportunity_id=OPPORTUNITY_ID,
        opportunity_name="Acme",
        opportunity_is_closed=False,
        enabled=True,
        follow_up_status="Pending",
        next_follow_up_at=None,
        attempt_count=0,
        last_follow_up_at=None,
        last_follow_up_result=None,
    )
    return SelectionResult(SelectionDecision.READY, SelectionReason.READY, quote)


class TestContactOptOutConfiguration(unittest.TestCase):
    """Verify optional and configured Contact opt-out behavior."""

    def test_no_opt_out_field_configured_continues_without_querying_one(self) -> None:
        client = _client(
            {"Id", "Name", "Phone", "MobilePhone"},
            _contact_record(),
        )
        repository = QuoteRepository(client)

        repository.validate_schema()
        contacts = repository._load_primary_contacts([OPPORTUNITY_ID])

        contact = contacts[OPPORTUNITY_ID][0]
        self.assertFalse(contact.do_not_call)
        self.assertEqual(
            validate_callable_contact(_ready_result(), [contact]).decision,
            SelectionDecision.READY,
        )
        soql = client.query.call_args.args[0]
        self.assertNotIn("Contact.DoNotCall", soql)

    def test_configured_opt_out_field_false_continues(self) -> None:
        client = _client(
            {"Id", "Name", "Phone", "MobilePhone", OPT_OUT_FIELD},
            _contact_record(**{OPT_OUT_FIELD: False}),
        )
        repository = QuoteRepository(client, do_not_call_field=OPT_OUT_FIELD)

        repository.validate_schema()
        contact = repository._load_primary_contacts([OPPORTUNITY_ID])[OPPORTUNITY_ID][0]

        self.assertFalse(contact.do_not_call)
        self.assertEqual(
            validate_callable_contact(_ready_result(), [contact]).decision,
            SelectionDecision.READY,
        )
        self.assertIn(f"Contact.{OPT_OUT_FIELD}", client.query.call_args.args[0])

    def test_configured_opt_out_field_true_returns_do_not_call(self) -> None:
        client = _client(
            {"Id", "Name", "Phone", "MobilePhone", OPT_OUT_FIELD},
            _contact_record(**{OPT_OUT_FIELD: True}),
        )
        repository = QuoteRepository(client, do_not_call_field=OPT_OUT_FIELD)

        repository.validate_schema()
        contact = repository._load_primary_contacts([OPPORTUNITY_ID])[OPPORTUNITY_ID][0]
        result = validate_callable_contact(_ready_result(), [contact])

        self.assertTrue(contact.do_not_call)
        self.assertEqual(result.reason, SelectionReason.DO_NOT_CALL)

    def test_configured_opt_out_field_must_exist(self) -> None:
        client = _client(
            {"Id", "Name", "Phone", "MobilePhone"},
            _contact_record(),
        )
        repository = QuoteRepository(client, do_not_call_field=OPT_OUT_FIELD)

        with self.assertRaisesRegex(
            SalesforceSchemaError,
            rf"Configured Contact opt-out field does not exist on Contact: {OPT_OUT_FIELD}",
        ):
            repository.validate_schema()


if __name__ == "__main__":
    unittest.main()
