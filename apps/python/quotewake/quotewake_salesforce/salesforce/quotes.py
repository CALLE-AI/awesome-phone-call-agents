"""Salesforce Quote and Opportunity Contact Role read repository."""

from __future__ import annotations

import re
import logging
from typing import Any

from quotewake_salesforce.config import RegionalSettings
from quotewake_salesforce.domain.models import ContactTarget, Money, QuoteCandidate, QuoteLine
from quotewake_salesforce.structured_logging import log_event

from .client import (
    SalesforceClient,
    SalesforceError,
    SalesforceQueryError,
    SalesforceResponseError,
    SalesforceSchemaError,
)
from .codecs import (
    boolean,
    decimal,
    metadata_integer,
    non_negative_integer,
    nullable_date,
    nullable_datetime,
    nullable_decimal,
    nullable_text,
    picklist,
    required,
    required_datetime,
    salesforce_id,
)


REQUIRED_QUOTE_FIELDS = {
    "Id",
    "Name",
    "OpportunityId",
    "Status",
    "ExpirationDate",
    "LastModifiedDate",
    "QuoteWake_Enabled__c",
    "Follow_Up_Status__c",
    "Next_Follow_Up_At__c",
    "Attempt_Count__c",
}
REQUIRED_CONTACT_FIELDS = {"Id", "Name", "Phone", "MobilePhone"}
REQUIRED_CONTACT_FIELDS.add("QuoteWake_Call_Locale__c")
# BillingCountryCode is a compound Salesforce field and is not exposed for
# field-level permission assignment in every org. QuoteWake can use the
# callable Contact locale as its regional fallback instead.
REQUIRED_ACCOUNT_FIELDS: set[str] = set()
REQUIRED_ORGANIZATION_FIELDS = {"TimeZoneSidKey", "DefaultLocaleSidKey"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9]{15,18}$")


def _field_map(description: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if not isinstance(description, dict):
        raise SalesforceSchemaError("Salesforce object describe was not a JSON object.")
    fields = description.get("fields")
    if not isinstance(fields, list):
        raise SalesforceSchemaError("Salesforce object describe did not contain fields.")
    result: dict[str, dict[str, Any]] = {}
    for field in fields:
        if not isinstance(field, dict) or not isinstance(field.get("name"), str):
            raise SalesforceSchemaError("Salesforce object describe contained a malformed field.")
        name = field["name"]
        if name in result:
            raise SalesforceSchemaError(f"Salesforce object describe repeated field {name}.")
        result[name] = field
    return result


_EXPECTED_FIELD_TYPES: dict[str, frozenset[str]] = {
    "Id": frozenset({"id"}),
    "Name": frozenset({"string"}),
    "OpportunityId": frozenset({"reference"}),
    "Status": frozenset({"picklist"}),
    "ExpirationDate": frozenset({"date"}),
    "LastModifiedDate": frozenset({"datetime"}),
    "QuoteWake_Enabled__c": frozenset({"boolean"}),
    "Follow_Up_Status__c": frozenset({"picklist", "string"}),
    "Next_Follow_Up_At__c": frozenset({"datetime"}),
    "Attempt_Count__c": frozenset({"int", "double", "currency"}),
}


def _validate_field_metadata(
    fields: dict[str, dict[str, Any]],
    names: set[str],
    *,
    object_name: str,
) -> None:
    """Validate describe metadata when present, retaining simple test doubles."""

    for name in names:
        field = fields[name]
        field_type = field.get("type")
        expected = _EXPECTED_FIELD_TYPES.get(name)
        if field_type is not None and expected and field_type not in expected:
            raise SalesforceSchemaError(
                f"Salesforce {object_name}.{name} has type {field_type!r}; "
                f"expected one of {sorted(expected)}."
            )
        if field_type in {"currency", "double"}:
            for metadata_name in ("precision", "scale"):
                if metadata_name in field:
                    metadata_integer(field[metadata_name], f"{object_name}.{name}.{metadata_name}")


def _active_picklist_values(field: dict[str, Any]) -> set[str] | None:
    values = field.get("picklistValues")
    if values is None:
        return None
    if not isinstance(values, list):
        raise SalesforceSchemaError("Salesforce picklist metadata is malformed.")
    active: set[str] = set()
    for item in values:
        if not isinstance(item, dict) or not isinstance(item.get("value"), str):
            raise SalesforceSchemaError("Salesforce picklist metadata contains a malformed value.")
        if item.get("active", True) is True:
            active.add(item["value"])
    return active


class QuoteRepository:
    """Read Quotes and primary Opportunity Contact Roles from Salesforce."""

    def __init__(
        self,
        client: SalesforceClient,
        do_not_call_field: str | None = None,
        default_currency_code: str | None = None,
    ) -> None:
        self.client = client
        self.do_not_call_field = do_not_call_field
        if default_currency_code is not None and not re.fullmatch(
            r"[A-Z]{3}", default_currency_code
        ):
            raise ValueError("default currency code must be a three-letter ISO code")
        self.default_currency_code = default_currency_code
        self._schema_cache: tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]] | None = None

    def validate_schema(self) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        """Validate required objects/fields and return their field maps."""

        if self._schema_cache is not None:
            return self._schema_cache

        log_event(
            "salesforce_schema_validation_started",
            do_not_call_field_configured=bool(self.do_not_call_field),
        )
        try:
            quote_fields = _field_map(self.client.describe("Quote"))
        except Exception as exc:
            if isinstance(exc, SalesforceError):
                raise
            raise SalesforceSchemaError(
                "The standard Salesforce Quote object is unavailable or cannot be described."
            ) from exc
        missing_quotes = sorted(REQUIRED_QUOTE_FIELDS - quote_fields.keys())
        if missing_quotes:
            raise SalesforceSchemaError(
                "QuoteWake Quote fields are missing: " + ", ".join(missing_quotes)
            )
        _validate_field_metadata(quote_fields, REQUIRED_QUOTE_FIELDS, object_name="Quote")
        for picklist_name in ("Status", "Follow_Up_Status__c"):
            _active_picklist_values(quote_fields[picklist_name])
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
        # Contact describe metadata is optional in small fake clients, but a
        # real describe response must not silently change the types consumed by
        # the callable-contact boundary.
        for name, expected in {
            "Id": {"id"},
            "Name": {"string"},
            "Phone": {"phone", "string"},
            "MobilePhone": {"phone", "string"},
        }.items():
            field_type = contact_fields[name].get("type")
            if field_type is not None and field_type not in expected:
                raise SalesforceSchemaError(
                    f"Salesforce Contact.{name} has unexpected type {field_type!r}."
                )
        locale_type = contact_fields["QuoteWake_Call_Locale__c"].get("type")
        if locale_type is not None and locale_type not in {"picklist", "string"}:
            raise SalesforceSchemaError(
                "Salesforce Contact.QuoteWake_Call_Locale__c has unexpected type "
                f"{locale_type!r}."
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
        try:
            account_fields = _field_map(self.client.describe("Account"))
        except Exception as exc:
            raise SalesforceSchemaError(
                "The standard Salesforce Account object is unavailable or cannot be described."
            ) from exc
        log_event(
            "salesforce_schema_validation_completed",
            quote_field_count=len(quote_fields),
            contact_field_count=len(contact_fields),
            account_field_count=len(account_fields),
            organization_field_count=0,
            do_not_call_field_configured=bool(self.do_not_call_field),
        )
        self._schema_cache = (quote_fields, contact_fields)
        return self._schema_cache

    def load_organization_regional_settings(self) -> RegionalSettings:
        """Read the organization timezone and default locale from Salesforce."""

        try:
            records = self.client.query(
                "SELECT TimeZoneSidKey, DefaultLocaleSidKey FROM Organization LIMIT 1"
            )
        except SalesforceError:
            # Minimum Access users may authenticate and use business objects
            # without access to the setup-only Organization object. Keep the
            # runtime least-privileged and use the safe presentation defaults.
            log_event(
                "salesforce_organization_settings_unavailable",
                fallback_timezone="UTC",
                fallback_locale="en_US",
            )
            return RegionalSettings.from_values("UTC", "en_US")
        if len(records) != 1:
            raise SalesforceResponseError(
                "Salesforce Organization query did not return exactly one record."
            )
        record = records[0]
        timezone_value = required(record, "TimeZoneSidKey")
        locale = required(record, "DefaultLocaleSidKey")
        if not isinstance(timezone_value, str) or not timezone_value.strip():
            raise SalesforceResponseError(
                "Salesforce Organization.TimeZoneSidKey is missing or malformed."
            )
        if not isinstance(locale, str) or not locale.strip():
            raise SalesforceResponseError(
                "Salesforce Organization.DefaultLocaleSidKey is missing or malformed."
            )
        try:
            return RegionalSettings.from_values(timezone_value, locale)
        except ValueError as exc:
            raise SalesforceResponseError(
                "Salesforce Organization regional settings are invalid."
            ) from exc

    def load(
        self, *, quote_id: str | None = None
    ) -> tuple[list[QuoteCandidate], dict[str, list[ContactTarget]]]:
        """Load quote candidates and primary contacts with read-only SOQL."""

        log_event(
            "salesforce_quote_repository_load_started",
            quote_id=quote_id,
            filtered_to_quote=quote_id is not None,
        )
        if quote_id is not None:
            quote_id = salesforce_id(quote_id, "Quote ID", prefix="0Q")

        quote_fields, _ = self.validate_schema()
        amount_field = next(
            (field for field in ("GrandTotal", "TotalPrice", "Subtotal") if field in quote_fields),
            None,
        )
        if amount_field is not None:
            amount_metadata = quote_fields[amount_field]
            amount_type = amount_metadata.get("type")
            if amount_type is not None and amount_type not in {"currency", "double"}:
                raise SalesforceSchemaError(
                    f"Salesforce Quote.{amount_field} is not a numeric/currency field."
                )
            # A real describe response must include these values for exact
            # money reporting.  Name-only test doubles are still supported.
            if "type" in amount_metadata:
                for metadata_name in ("precision", "scale"):
                    if metadata_name not in amount_metadata:
                        raise SalesforceSchemaError(
                            f"Salesforce Quote.{amount_field} is missing {metadata_name} metadata."
                        )
                    metadata_integer(
                        amount_metadata[metadata_name],
                        f"Quote.{amount_field}.{metadata_name}",
                    )
        currency_field = "CurrencyIsoCode" if "CurrencyIsoCode" in quote_fields else None
        if currency_field is not None:
            currency_type = quote_fields[currency_field].get("type")
            if currency_type is not None and currency_type not in {"picklist", "string"}:
                raise SalesforceSchemaError(
                    "Salesforce Quote.CurrencyIsoCode is not a text/picklist field."
                )
        selected_fields = [
            "Id",
            "Name",
            "Status",
            "ExpirationDate",
            "LastModifiedDate",
            "OpportunityId",
            "Opportunity.Name",
            "Opportunity.Account.Name",
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
        ]
        where_clause = "OpportunityId != null"
        if quote_id is not None:
            where_clause = f"Id = '{quote_id}' AND {where_clause}"
        soql = (
            "SELECT "
            + ", ".join(selected_fields)
            + f" FROM Quote WHERE {where_clause} ORDER BY LastModifiedDate ASC, Id ASC"
        )
        records = self.client.query(soql)
        # Single-currency orgs do not expose CurrencyIsoCode on Quote. Resolve
        # the org default so commercial amounts retain their denomination in
        # human output and CALL-E context.
        corporate_currency = (
            self._corporate_currency()
            if records and currency_field is None
            else None
        )
        quotes = [
            self._quote_from_record(record, amount_field, currency_field, corporate_currency, quote_fields)
            for record in records
        ]
        opportunity_ids = sorted({quote.opportunity_id for quote in quotes})
        contacts = self._load_primary_contacts(opportunity_ids)
        log_event(
            "salesforce_quote_repository_load_completed",
            quote_count=len(quotes),
            opportunity_count=len(opportunity_ids),
            contact_group_count=len(contacts),
        )
        return quotes, contacts

    def _corporate_currency(self) -> str:
        """Return the explicitly configured currency for a single-currency org."""

        if self.default_currency_code is None:
            raise SalesforceSchemaError(
                "Salesforce Quote.CurrencyIsoCode is unavailable in this single-currency "
                "org. Configure SALESFORCE_CURRENCY_CODE with its ISO code, for example EUR."
            )
        return self.default_currency_code

    def _quote_from_record(
        self,
        record: dict[str, Any],
        amount_field: str | None,
        currency_field: str | None,
        corporate_currency: str | None = None,
        field_metadata: dict[str, dict[str, Any]] | None = None,
    ) -> QuoteCandidate:
        quote_id = salesforce_id(required(record, "Id"), "Id", prefix="0Q")
        quote_name = nullable_text(required(record, "Name"), "Name", maximum=255)
        opportunity_id = salesforce_id(required(record, "OpportunityId"), "OpportunityId", prefix="006")
        opportunity = required(record, "Opportunity")
        if not quote_name:
            raise SalesforceResponseError("Quote response contains an invalid identity field.")
        if not isinstance(opportunity, dict):
            raise SalesforceResponseError(f"Quote {quote_id} has no Opportunity relationship data.")
        # Decode the required timing field before the remaining optional
        # commercial values so malformed Salesforce records fail at the exact
        # missing boundary field rather than being silently defaulted.
        last_modified_at = required_datetime(
            required(record, "LastModifiedDate"), "LastModifiedDate"
        )
        opportunity_name = nullable_text(required(opportunity, "Name"), "Opportunity.Name", maximum=120)
        account = required(opportunity, "Account")
        if account is not None and not isinstance(account, dict):
            raise SalesforceResponseError(f"Quote {quote_id} has invalid Account data.")
        account_name = (
            nullable_text(required(account, "Name"), "Opportunity.Account.Name", maximum=255)
            if isinstance(account, dict)
            else None
        )
        account_billing_country_code = (
            nullable_text(account.get("BillingCountryCode"), "Opportunity.Account.BillingCountryCode", maximum=2)
            if isinstance(account, dict) and account.get("BillingCountryCode") is not None
            else None
        )
        raw_metadata = field_metadata.get(amount_field, {}) if field_metadata and amount_field else {}
        scale = metadata_integer(raw_metadata.get("scale"), f"Quote.{amount_field}.scale") if amount_field and "scale" in raw_metadata else None
        precision = metadata_integer(raw_metadata.get("precision"), f"Quote.{amount_field}.precision") if amount_field and "precision" in raw_metadata else None
        amount = decimal(required(record, amount_field), amount_field, precision=precision, scale=scale) if amount_field else None
        currency_values = (
            _active_picklist_values(field_metadata[currency_field])
            if field_metadata and currency_field and currency_field in field_metadata
            else None
        )
        currency = (
            picklist(required(record, currency_field), currency_field, currency_values)
            if currency_field
            else corporate_currency
        )
        if currency_field and currency is None:
            raise SalesforceResponseError(
                f"Salesforce field {currency_field} is unexpectedly empty."
            )
        if currency is not None and not re.fullmatch(r"[A-Z]{3}", currency):
            raise SalesforceResponseError("Salesforce returned an invalid ISO currency code.")
        status_values = (
            _active_picklist_values(field_metadata["Status"])
            if field_metadata and "Status" in field_metadata
            else None
        )
        follow_up_values = (
            _active_picklist_values(field_metadata["Follow_Up_Status__c"])
            if field_metadata and "Follow_Up_Status__c" in field_metadata
            else None
        )
        status = picklist(required(record, "Status"), "Status", status_values)
        if not status:
            raise SalesforceResponseError("Salesforce field Status is unexpectedly empty.")
        follow_up_status = picklist(
            required(record, "Follow_Up_Status__c"),
            "Follow_Up_Status__c",
            follow_up_values,
        )
        money = None
        if amount is not None and currency is not None and amount_field is not None:
            effective_scale = scale
            if effective_scale is None:
                effective_scale = max(0, -amount.as_tuple().exponent)
            money = Money(amount, currency, amount_field, effective_scale)
        return QuoteCandidate(
            quote_id=quote_id,
            quote_name=quote_name,
            quote_status=status,
            amount=amount,
            currency_code=currency,
            expiration_date=nullable_date(required(record, "ExpirationDate"), "ExpirationDate"),
            last_modified_at=last_modified_at,
            opportunity_id=opportunity_id,
            opportunity_name=opportunity_name,
            account_name=account_name,
            opportunity_is_closed=boolean(required(opportunity, "IsClosed"), "Opportunity.IsClosed"),
            enabled=boolean(required(record, "QuoteWake_Enabled__c"), "QuoteWake_Enabled__c"),
            follow_up_status=follow_up_status,
            next_follow_up_at=nullable_datetime(required(record, "Next_Follow_Up_At__c"), "Next_Follow_Up_At__c"),
            attempt_count=non_negative_integer(required(record, "Attempt_Count__c"), "Attempt_Count__c", precision=(field_metadata or {}).get("Attempt_Count__c", {}).get("precision")),
            money=money,
            account_billing_country_code=account_billing_country_code,
        )

    def load_quote_lines(
        self,
        quote_ids: list[str],
        *,
        currency_by_quote: dict[str, str] | None = None,
    ) -> dict[str, list[QuoteLine]]:
        """Load concise line-item context for selected Quotes in batched SOQL."""

        if not quote_ids:
            return {}
        log_event(
            "salesforce_quote_lines_load_started",
            quote_count=len(quote_ids),
        )
        if not all(ID_PATTERN.fullmatch(value) for value in quote_ids):
            raise SalesforceResponseError("QuoteWake received an invalid Quote ID.")

        line_map: dict[str, list[QuoteLine]] = {}
        for start in range(0, len(quote_ids), 200):
            chunk = quote_ids[start : start + 200]
            quoted_ids = ", ".join(f"'{value}'" for value in chunk)
            soql = (
                "SELECT QuoteId, Product2.Name, Product2.QuantityUnitOfMeasure, "
                "Quantity, UnitPrice, TotalPrice "
                f"FROM QuoteLineItem WHERE QuoteId IN ({quoted_ids}) "
                "ORDER BY QuoteId, SortOrder ASC"
            )
            try:
                records = self.client.query(soql)
            except SalesforceQueryError as exc:
                # Some Salesforce user licenses do not expose QuoteLineItem.
                # Lines enrich the prompt but are not required for follow-up.
                if "sObject type 'QuoteLineItem' is not supported" not in str(exc):
                    raise
                log_event(
                    "salesforce_quote_lines_unavailable",
                    level=logging.DEBUG,
                    reason="QuoteLineItem is not supported for the runtime user",
                )
                return {}
            for record in records:
                quote_id = salesforce_id(required(record, "QuoteId"), "QuoteLineItem.QuoteId", prefix="0Q")
                product = required(record, "Product2")
                if not isinstance(product, dict):
                    raise SalesforceResponseError(
                        "QuoteLineItem response has malformed Quote or Product data."
                    )
                product_name = nullable_text(required(product, "Name"), "QuoteLineItem.Product2.Name", maximum=255)
                if not product_name:
                    raise SalesforceResponseError(
                        f"QuoteLineItem for {quote_id} has no Product name."
                    )
                line_map.setdefault(quote_id, []).append(
                    QuoteLine(
                        product_name=product_name,
                        quantity=nullable_decimal(required(record, "Quantity"), "QuoteLineItem.Quantity"),
                        unit_price=nullable_decimal(required(record, "UnitPrice"), "QuoteLineItem.UnitPrice"),
                        total_price=nullable_decimal(required(record, "TotalPrice"), "QuoteLineItem.TotalPrice"),
                        currency_code=(currency_by_quote or {}).get(quote_id),
                        quantity_unit=nullable_text(
                            product.get("QuantityUnitOfMeasure"),
                            "QuoteLineItem.Product2.QuantityUnitOfMeasure",
                            maximum=40,
                        ),
                    )
                )
        log_event(
            "salesforce_quote_lines_load_completed",
            quote_count=len(quote_ids),
            line_count=sum(len(lines) for lines in line_map.values()),
        )
        return line_map

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
                "Contact.QuoteWake_Call_Locale__c",
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
                is_primary = record.get("IsPrimary")
                if not isinstance(is_primary, bool):
                    raise SalesforceResponseError("OpportunityContactRole.IsPrimary is not a JSON boolean.")
                if not is_primary:
                    continue
                opportunity_id = salesforce_id(
                    required(record, "OpportunityId"),
                    "OpportunityContactRole.OpportunityId",
                    prefix="006",
                )
                contact_id = salesforce_id(
                    required(record, "ContactId"),
                    "OpportunityContactRole.ContactId",
                    prefix="003",
                )
                contact = required(record, "Contact")
                if not isinstance(contact, dict):
                    raise SalesforceResponseError(
                        f"OpportunityContactRole for {opportunity_id} has malformed Contact data."
                    )
                contact_name = nullable_text(required(contact, "Name"), "Contact.Name", maximum=255)
                if not contact_name:
                    raise SalesforceResponseError(
                        f"OpportunityContactRole for {opportunity_id} has malformed Contact data."
                    )
                mobile_phone = nullable_text(
                    required(contact, "MobilePhone"), "Contact.MobilePhone", maximum=40
                )
                phone = nullable_text(
                    required(contact, "Phone"), "Contact.Phone", maximum=40
                )
                selected_phone = mobile_phone or phone
                call_locale = nullable_text(
                    required(contact, "QuoteWake_Call_Locale__c"),
                    "Contact.QuoteWake_Call_Locale__c",
                    maximum=35,
                )
                if self.do_not_call_field is not None:
                    opt_out = required(contact, self.do_not_call_field)
                    if opt_out is not None and not isinstance(opt_out, bool):
                        raise SalesforceResponseError(
                            f"Contact {contact_id} opt-out field is not a JSON boolean."
                        )
                if selected_phone is not None and not isinstance(selected_phone, str):
                    raise SalesforceResponseError(
                        f"Contact {contact_id} has a malformed phone field."
                    )
                contact_map.setdefault(opportunity_id, []).append(
                    ContactTarget(
                        contact_id=contact_id,
                        name=contact_name,
                        phone=selected_phone,
                        do_not_call=(
                            self.do_not_call_field is not None
                            and contact.get(self.do_not_call_field) is True
                        ),
                        call_locale=call_locale,
                    )
                )
        return contact_map
