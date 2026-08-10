"""Tests for Salesforce Contact opt-out field configuration."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
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
from quotewake_salesforce.salesforce.quotes import (
    FOLLOW_UP_RESULT_VALUES,
    REQUIRED_QUOTE_FIELDS,
    QuoteRepository,
)


OPPORTUNITY_ID = "006000000000001"
CONTACT_ID = "003000000000001"
OPT_OUT_FIELD = "QuoteWake_Do_Not_Call__c"


def _description(field_names: set[str]) -> dict[str, list[dict[str, str]]]:
    return {"fields": [{"name": name} for name in sorted(field_names)]}


def _quote_description(
    *,
    result_type: str = "picklist",
    result_values: list[dict[str, object]] | None = None,
) -> dict[str, list[dict[str, object]]]:
    fields = [{"name": name} for name in sorted(REQUIRED_QUOTE_FIELDS)]
    result_field = next(
        field for field in fields if field["name"] == "Last_Follow_Up_Result__c"
    )
    result_field["type"] = result_type
    if result_values is not None:
        result_field["picklistValues"] = result_values
    return {"fields": fields}


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


class TestQuoteResultPicklistSchema(unittest.TestCase):
    """Verify metadata for the constrained Salesforce result picklist."""

    def _client(self, result_field: dict[str, object]) -> Mock:
        client = Mock()
        client.describe.side_effect = [
            _quote_description(**result_field),
            _description({"Id", "Name", "Phone", "MobilePhone"}),
        ]
        return client

    def test_accepts_picklist_with_all_simulator_outcomes_active(self) -> None:
        client = self._client(
            {
                "result_type": "picklist",
                "result_values": [
                    {"value": value, "active": True}
                    for value in sorted(FOLLOW_UP_RESULT_VALUES)
                ],
            }
        )

        quote_fields, _ = QuoteRepository(client).validate_schema()

        self.assertEqual(quote_fields["Last_Follow_Up_Result__c"]["type"], "picklist")

    def test_rejects_picklist_missing_an_active_simulator_outcome(self) -> None:
        values = [
            {"value": value, "active": value != "Error"}
            for value in sorted(FOLLOW_UP_RESULT_VALUES)
        ]
        client = self._client({"result_type": "picklist", "result_values": values})

        with self.assertRaisesRegex(
            SalesforceSchemaError,
            r"Last_Follow_Up_Result__c is missing active picklist values: Error",
        ):
            QuoteRepository(client).validate_schema()

    def test_rejects_picklist_without_values_metadata(self) -> None:
        client = self._client({"result_type": "picklist"})

        with self.assertRaisesRegex(
            SalesforceSchemaError,
            r"Last_Follow_Up_Result__c is a picklist without picklist values metadata",
        ):
            QuoteRepository(client).validate_schema()


class TestQuoteLoading(unittest.TestCase):
    def test_single_currency_quote_resolves_org_default_currency(self) -> None:
        quote_fields = _quote_description(
            result_values=[
                {"value": value, "active": True}
                for value in sorted(FOLLOW_UP_RESULT_VALUES)
            ]
        )["fields"]
        quote_fields.append(
            {"name": "GrandTotal", "type": "currency", "precision": 18, "scale": 2}
        )
        quote_record = {
            "Id": "0Q0000000000001",
            "Name": "Q-001",
            "Status": "Presented",
            "ExpirationDate": None,
            "LastModifiedDate": "2026-08-07T12:00:00.000+0000",
            "OpportunityId": OPPORTUNITY_ID,
            "Opportunity": {
                "Name": "Demo opportunity",
                "Account": {"Name": "Demo account"},
                "IsClosed": False,
            },
            "GrandTotal": Decimal("1234.50"),
            "QuoteWake_Enabled__c": True,
            "Follow_Up_Status__c": None,
            "Next_Follow_Up_At__c": None,
            "Attempt_Count__c": 0,
            "Last_Follow_Up_At__c": None,
            "Last_Follow_Up_Result__c": None,
        }
        client = Mock()
        client.describe.side_effect = [
            {"fields": quote_fields},
            _description({"Id", "Name", "Phone", "MobilePhone"}),
        ]
        client.query.side_effect = [
            [quote_record],
            [{"DefaultCurrencyIsoCode": "EUR"}],
            [_contact_record()],
        ]

        quotes, contacts = QuoteRepository(client).load()

        self.assertEqual(quotes[0].amount, Decimal("1234.50"))
        self.assertEqual(quotes[0].currency_code, "EUR")
        self.assertIsNotNone(quotes[0].money)
        assert quotes[0].money is not None
        self.assertEqual(quotes[0].money.currency, "EUR")
        self.assertIn(OPPORTUNITY_ID, contacts)
        self.assertEqual(client.query.call_count, 3)
        self.assertNotIn("CurrencyIsoCode", client.query.call_args_list[0].args[0])
        self.assertIn("DefaultCurrencyIsoCode", client.query.call_args_list[1].args[0])

    def test_single_currency_quote_rejects_missing_org_default_currency(self) -> None:
        quote_fields = _quote_description(
            result_values=[
                {"value": value, "active": True}
                for value in sorted(FOLLOW_UP_RESULT_VALUES)
            ]
        )["fields"]
        quote_fields.append(
            {"name": "GrandTotal", "type": "currency", "precision": 18, "scale": 2}
        )
        quote_record = {
            "Id": "0Q0000000000001",
            "Name": "Q-001",
            "Status": "Presented",
            "ExpirationDate": None,
            "LastModifiedDate": "2026-08-07T12:00:00.000+0000",
            "OpportunityId": OPPORTUNITY_ID,
            "Opportunity": {
                "Name": "Demo opportunity",
                "Account": {"Name": "Demo account"},
                "IsClosed": False,
            },
            "GrandTotal": Decimal("1234.50"),
            "QuoteWake_Enabled__c": True,
            "Follow_Up_Status__c": None,
            "Next_Follow_Up_At__c": None,
            "Attempt_Count__c": 0,
            "Last_Follow_Up_At__c": None,
            "Last_Follow_Up_Result__c": None,
        }
        client = Mock()
        client.describe.side_effect = [
            {"fields": quote_fields},
            _description({"Id", "Name", "Phone", "MobilePhone"}),
        ]
        client.query.side_effect = [[quote_record], [{}]]

        with self.assertRaisesRegex(
            SalesforceResponseError,
            "missing DefaultCurrencyIsoCode",
        ):
            QuoteRepository(client).load()

    def test_single_currency_quote_rejects_invalid_org_default_currency(self) -> None:
        quote_fields = _quote_description(
            result_values=[
                {"value": value, "active": True}
                for value in sorted(FOLLOW_UP_RESULT_VALUES)
            ]
        )["fields"]
        quote_fields.append(
            {"name": "GrandTotal", "type": "currency", "precision": 18, "scale": 2}
        )
        quote_record = {
            "Id": "0Q0000000000001",
            "Name": "Q-001",
            "Status": "Presented",
            "ExpirationDate": None,
            "LastModifiedDate": "2026-08-07T12:00:00.000+0000",
            "OpportunityId": OPPORTUNITY_ID,
            "Opportunity": {
                "Name": "Demo opportunity",
                "Account": {"Name": "Demo account"},
                "IsClosed": False,
            },
            "GrandTotal": Decimal("1234.50"),
            "QuoteWake_Enabled__c": True,
            "Follow_Up_Status__c": None,
            "Next_Follow_Up_At__c": None,
            "Attempt_Count__c": 0,
            "Last_Follow_Up_At__c": None,
            "Last_Follow_Up_Result__c": None,
        }
        client = Mock()
        client.describe.side_effect = [
            {"fields": quote_fields},
            _description({"Id", "Name", "Phone", "MobilePhone"}),
        ]
        client.query.side_effect = [[quote_record], [{"DefaultCurrencyIsoCode": "EURO"}]]

        with self.assertRaisesRegex(
            SalesforceResponseError,
            "(?:exceeds 3 characters|invalid default currency code)",
        ):
            QuoteRepository(client).load()


class TestQuoteLoadingFilter(unittest.TestCase):
    def test_quote_id_filter_is_validated_and_constrains_soql(self) -> None:
        quote_id = "0Q0000000000001"
        client = Mock()
        client.describe.side_effect = [
            _description(REQUIRED_QUOTE_FIELDS),
            _description({"Id", "Name", "Phone", "MobilePhone"}),
        ]
        client.query.return_value = []

        QuoteRepository(client).load(quote_id=quote_id)

        self.assertEqual(client.query.call_count, 1)
        soql = client.query.call_args.args[0]
        self.assertIn(f"WHERE Id = '{quote_id}' AND OpportunityId != null", soql)
        self.assertNotIn("FROM Organization", soql)

    def test_quote_id_filter_rejects_invalid_ids_before_schema_queries(self) -> None:
        client = Mock()

        with self.assertRaisesRegex(SalesforceResponseError, "invalid ID"):
            QuoteRepository(client).load(quote_id="not-a-salesforce-id")

        client.describe.assert_not_called()
        client.query.assert_not_called()


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
