"""Tests for Salesforce Contact opt-out field configuration."""

from __future__ import annotations

from datetime import datetime, timezone
import unittest
from unittest.mock import Mock

from quotewake_salesforce.domain.models import (
    QuoteCandidate,
    SelectionDecision,
    SelectionReason,
    SelectionResult,
)
from quotewake_salesforce.domain.selection import validate_callable_contact
from quotewake_salesforce.salesforce.client import (
    SalesforceResponseError,
    SalesforceSchemaError,
)
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
        last_modified_at=datetime(2026, 8, 7, 12, tzinfo=timezone.utc),
        opportunity_id=OPPORTUNITY_ID,
        opportunity_name="Acme",
        account_name="Acme",
        opportunity_is_closed=False,
        enabled=True,
        follow_up_status=None,
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


class TestQuoteLineLoading(unittest.TestCase):
    def test_quote_lines_are_loaded_in_one_batched_query(self) -> None:
        client = Mock()
        client.query.return_value = [
            {
                "QuoteId": "0Q0000000000001",
                "Product2": {"Name": "Electrical labor"},
                "Quantity": 18,
                "UnitPrice": 150,
                "TotalPrice": 2700,
            }
        ]
        repository = QuoteRepository(client)

        result = repository.load_quote_lines(["0Q0000000000001"])

        self.assertEqual(result["0Q0000000000001"][0].product_name, "Electrical labor")
        self.assertEqual(str(result["0Q0000000000001"][0].total_price), "2700")
        soql = client.query.call_args.args[0]
        self.assertIn("FROM QuoteLineItem", soql)
        self.assertIn("'0Q0000000000001'", soql)

    def test_quote_line_loading_rejects_invalid_ids(self) -> None:
        repository = QuoteRepository(Mock())

        with self.assertRaisesRegex(SalesforceResponseError, "invalid Quote ID"):
            repository.load_quote_lines(["not-an-id"])


class TestQuoteMapping(unittest.TestCase):
    def test_maps_last_modified_date_as_initial_timing_reference(self) -> None:
        repository = QuoteRepository(Mock())
        record = {
            "Id": "0Q0000000000001",
            "Name": "Q-001",
            "Status": "Presented",
            "ExpirationDate": "2026-08-31",
            "LastModifiedDate": "2026-08-07T12:00:00.000+0000",
            "OpportunityId": OPPORTUNITY_ID,
            "Opportunity": {
                "Name": "Demo opportunity",
                "Account": {"Name": "Demo account"},
                "IsClosed": False,
            },
            "QuoteWake_Enabled__c": True,
            "Follow_Up_Status__c": None,
            "Next_Follow_Up_At__c": None,
            "Attempt_Count__c": 0,
            "Last_Follow_Up_At__c": None,
            "Last_Follow_Up_Result__c": None,
        }

        quote = repository._quote_from_record(record, None, None)

        self.assertEqual(
            quote.last_modified_at,
            datetime(2026, 8, 7, 12, tzinfo=timezone.utc),
        )

    def test_rejects_missing_last_modified_date(self) -> None:
        repository = QuoteRepository(Mock())
        record = {
            "Id": "0Q0000000000001",
            "Name": "Q-001",
            "LastModifiedDate": None,
            "OpportunityId": OPPORTUNITY_ID,
            "Opportunity": {"Name": "Demo", "Account": None, "IsClosed": False},
        }

        with self.assertRaisesRegex(
            SalesforceResponseError, "LastModifiedDate is unexpectedly empty"
        ):
            repository._quote_from_record(record, None, None)


if __name__ == "__main__":
    unittest.main()
