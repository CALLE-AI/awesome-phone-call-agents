"""Salesforce Quote and Opportunity Contact Role read repository."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from quotewake_salesforce.domain.models import ContactTarget, QuoteCandidate

from .client import SalesforceClient, SalesforceResponseError, SalesforceSchemaError


REQUIRED_QUOTE_FIELDS = {
    "Id",
    "Name",
    "OpportunityId",
    "Status",
    "ExpirationDate",
    "QuoteWake_Enabled__c",
    "Follow_Up_Status__c",
    "Next_Follow_Up_At__c",
    "Attempt_Count__c",
    "Last_Follow_Up_At__c",
    "Last_Follow_Up_Result__c",
}
REQUIRED_CONTACT_FIELDS = {"Id", "Name", "Phone", "MobilePhone"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9]{15,18}$")


def _field_map(description: dict[str, Any]) -> dict[str, dict[str, Any]]:
    fields = description.get("fields")
    if not isinstance(fields, list):
        raise SalesforceSchemaError("Salesforce object describe did not contain fields.")
    result = {field.get("name"): field for field in fields if isinstance(field, dict)}
    return {name: field for name, field in result.items() if isinstance(name, str)}


def _parse_datetime(value: Any, field_name: str) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise SalesforceResponseError(f"Salesforce field {field_name} is not a string.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SalesforceResponseError(
            f"Salesforce field {field_name} contains an invalid DateTime."
        ) from exc
    if parsed.tzinfo is None:
        raise SalesforceResponseError(f"Salesforce field {field_name} is timezone-naive.")
    return parsed


def _parse_date(value: Any, field_name: str) -> date | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise SalesforceResponseError(f"Salesforce field {field_name} is not a string.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise SalesforceResponseError(
            f"Salesforce field {field_name} contains an invalid Date."
        ) from exc


def _parse_decimal(value: Any, field_name: str) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise SalesforceResponseError(
            f"Salesforce field {field_name} contains an invalid amount."
        ) from exc


def _parse_attempt_count(value: Any) -> int:
    if value in (None, ""):
        return 0
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise SalesforceResponseError(
            "Salesforce field Attempt_Count__c contains an invalid number."
        ) from exc
    return parsed


class QuoteRepository:
    """Read Quotes and primary Opportunity Contact Roles from Salesforce."""

    def __init__(
        self, client: SalesforceClient, do_not_call_field: str | None = None
    ) -> None:
        self.client = client
        self.do_not_call_field = do_not_call_field

    def validate_schema(self) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        """Validate required objects/fields and return their field maps."""

        try:
            quote_fields = _field_map(self.client.describe("Quote"))
        except Exception as exc:
            if isinstance(exc, SalesforceSchemaError):
                raise
            raise SalesforceSchemaError(
                "The standard Salesforce Quote object is unavailable or cannot be described."
            ) from exc
        missing_quotes = sorted(REQUIRED_QUOTE_FIELDS - quote_fields.keys())
        if missing_quotes:
            raise SalesforceSchemaError(
                "QuoteWake Quote fields are missing: " + ", ".join(missing_quotes)
            )

        try:
            contact_fields = _field_map(self.client.describe("Contact"))
        except Exception as exc:
            raise SalesforceSchemaError(
                "The standard Salesforce Contact object is unavailable or cannot be described."
            ) from exc
        missing_contacts = sorted(REQUIRED_CONTACT_FIELDS - contact_fields.keys())
        if missing_contacts:
            raise SalesforceSchemaError(
                "Contact fields required for callable-contact selection are missing: "
                + ", ".join(missing_contacts)
            )
        if self.do_not_call_field is not None:
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", self.do_not_call_field):
                raise SalesforceSchemaError(
                    f"Invalid Contact opt-out field API name: {self.do_not_call_field}"
                )
            if self.do_not_call_field not in contact_fields:
                raise SalesforceSchemaError(
                    "Configured Contact opt-out field does not exist on Contact: "
                    f"{self.do_not_call_field}"
                )
        return quote_fields, contact_fields

    def load(self) -> tuple[list[QuoteCandidate], dict[str, list[ContactTarget]]]:
        """Load quote candidates and primary contacts with read-only SOQL."""

        quote_fields, _ = self.validate_schema()
        amount_field = next(
            (field for field in ("GrandTotal", "TotalPrice", "Subtotal") if field in quote_fields),
            None,
        )
        currency_field = "CurrencyIsoCode" if "CurrencyIsoCode" in quote_fields else None
        selected_fields = [
            "Id",
            "Name",
            "Status",
            "ExpirationDate",
            "OpportunityId",
            "Opportunity.Name",
            "Opportunity.IsClosed",
            *(
                [amount_field]
                if amount_field
                else []
            ),
            *([currency_field] if currency_field else []),
            "QuoteWake_Enabled__c",
            "Follow_Up_Status__c",
            "Next_Follow_Up_At__c",
            "Attempt_Count__c",
            "Last_Follow_Up_At__c",
            "Last_Follow_Up_Result__c",
        ]
        soql = (
            "SELECT "
            + ", ".join(selected_fields)
            + " FROM Quote WHERE OpportunityId != null ORDER BY CreatedDate ASC"
        )
        records = self.client.query(soql)
        quotes = [self._quote_from_record(record, amount_field, currency_field) for record in records]
        opportunity_ids = sorted({quote.opportunity_id for quote in quotes})
        contacts = self._load_primary_contacts(opportunity_ids)
        return quotes, contacts

    def _quote_from_record(
        self, record: dict[str, Any], amount_field: str | None, currency_field: str | None
    ) -> QuoteCandidate:
        try:
            quote_id = record["Id"]
            quote_name = record["Name"]
            opportunity_id = record["OpportunityId"]
            opportunity = record["Opportunity"]
        except KeyError as exc:
            raise SalesforceResponseError(f"Quote response is missing {exc.args[0]}.") from exc
        if not all(isinstance(value, str) and value for value in (quote_id, quote_name, opportunity_id)):
            raise SalesforceResponseError("Quote response contains an invalid identity field.")
        if not isinstance(opportunity, dict):
            raise SalesforceResponseError(f"Quote {quote_id} has no Opportunity relationship data.")
        opportunity_name = opportunity.get("Name")
        if opportunity_name is not None and not isinstance(opportunity_name, str):
            raise SalesforceResponseError(f"Quote {quote_id} has an invalid Opportunity name.")
        return QuoteCandidate(
            quote_id=quote_id,
            quote_name=quote_name,
            quote_status=record.get("Status"),
            amount=_parse_decimal(record.get(amount_field) if amount_field else None, amount_field or "amount"),
            currency_code=record.get(currency_field) if currency_field else None,
            expiration_date=_parse_date(record.get("ExpirationDate"), "ExpirationDate"),
            opportunity_id=opportunity_id,
            opportunity_name=opportunity_name,
            opportunity_is_closed=bool(opportunity.get("IsClosed", False)),
            enabled=record.get("QuoteWake_Enabled__c") is True,
            follow_up_status=record.get("Follow_Up_Status__c"),
            next_follow_up_at=_parse_datetime(record.get("Next_Follow_Up_At__c"), "Next_Follow_Up_At__c"),
            attempt_count=_parse_attempt_count(record.get("Attempt_Count__c")),
            last_follow_up_at=_parse_datetime(record.get("Last_Follow_Up_At__c"), "Last_Follow_Up_At__c"),
            last_follow_up_result=record.get("Last_Follow_Up_Result__c"),
        )

    def _load_primary_contacts(
        self, opportunity_ids: list[str]
    ) -> dict[str, list[ContactTarget]]:
        if not opportunity_ids:
            return {}
        if not all(ID_PATTERN.fullmatch(value) for value in opportunity_ids):
            raise SalesforceResponseError("Salesforce returned an invalid Opportunity ID.")
        contact_map: dict[str, list[ContactTarget]] = {}
        for start in range(0, len(opportunity_ids), 200):
            chunk = opportunity_ids[start : start + 200]
            quoted_ids = ", ".join(f"'{value}'" for value in chunk)
            contact_fields = [
                "Contact.Name",
                "Contact.Phone",
                "Contact.MobilePhone",
            ]
            if self.do_not_call_field is not None:
                contact_fields.append(f"Contact.{self.do_not_call_field}")
            soql = (
                "SELECT OpportunityId, ContactId, IsPrimary, "
                + ", ".join(contact_fields)
                + " "
                f"FROM OpportunityContactRole WHERE OpportunityId IN ({quoted_ids})"
            )
            for record in self.client.query(soql):
                if record.get("IsPrimary") is not True:
                    continue
                opportunity_id = record.get("OpportunityId")
                contact_id = record.get("ContactId")
                contact = record.get("Contact")
                if not isinstance(opportunity_id, str) or not isinstance(contact_id, str):
                    raise SalesforceResponseError("OpportunityContactRole has invalid IDs.")
                if not isinstance(contact, dict) or not isinstance(contact.get("Name"), str):
                    raise SalesforceResponseError(
                        f"OpportunityContactRole for {opportunity_id} has malformed Contact data."
                    )
                selected_phone = contact.get("MobilePhone") or contact.get("Phone")
                if selected_phone is not None and not isinstance(selected_phone, str):
                    raise SalesforceResponseError(
                        f"Contact {contact_id} has a malformed phone field."
                    )
                contact_map.setdefault(opportunity_id, []).append(
                    ContactTarget(
                        contact_id=contact_id,
                        name=contact["Name"],
                        phone=selected_phone,
                        do_not_call=(
                            self.do_not_call_field is not None
                            and contact.get(self.do_not_call_field) is True
                        ),
                    )
                )
        return contact_map
