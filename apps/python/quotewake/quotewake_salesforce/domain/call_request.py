"""Build an execution-neutral CALL-E call request from Salesforce context."""

from __future__ import annotations

from decimal import Decimal
import re
from typing import Iterable

from babel import Locale
from babel.core import UnknownLocaleError

from quotewake_salesforce.config import CallPromptSettings, RegionalSettings
from quotewake_salesforce.presentation import format_business_date, format_money

from .models import CallRequest, QuoteLine, SelectionDecision, SelectionResult


def _safe_context(value: str | None, fallback: str, maximum: int = 120) -> str:
    if not value:
        return fallback
    cleaned = " ".join(value.split())
    return cleaned[:maximum] or fallback


def _decimal_text(value: Decimal | None) -> str:
    if value is None:
        return "not available"
    rendered = format(value, "f")
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


def _line_context(lines: Iterable[QuoteLine], currency: str | None, *, regional_settings: RegionalSettings | None = None) -> str:
    rendered: list[str] = []
    currency_label = _safe_context(currency, "currency not specified", maximum=8)
    for line in list(lines)[:10]:
        line_currency = format_money(line.total_price, line.currency_code or currency, regional_settings=regional_settings) if regional_settings is not None else f"{currency_label} {_decimal_text(line.total_price)}"
        unit = f" {line.quantity_unit}" if line.quantity_unit else ""
        rendered.append(f"- {_safe_context(line.product_name, 'Unnamed item')}; quantity {_decimal_text(line.quantity)}{unit}; line total {line_currency}")
    return "\n".join(rendered) if rendered else "- No Quote line items were available."


def _validate_locale(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z]{2}|-[0-9]{3})?", value):
        raise ValueError("CALL-E locale must use BCP-47 form such as es-ES")
    try:
        Locale.parse(value, sep="-")
    except (UnknownLocaleError, ValueError, TypeError) as exc:
        raise ValueError("CALL-E locale must be a valid BCP-47 locale") from exc
    return value


def _validate_region(value: str | None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Salesforce Account.BillingCountryCode is required for CALL-E calls")
    value = value.strip().upper()
    if not re.fullmatch(r"[A-Z]{2}", value):
        raise ValueError("Salesforce Account.BillingCountryCode must be an ISO 3166-1 alpha-2 code")
    return value


def build_call_request(result: SelectionResult, lines: Iterable[QuoteLine], *, prompt_settings: CallPromptSettings, regional_settings: RegionalSettings | None = None) -> CallRequest:
    if result.decision is not SelectionDecision.READY:
        raise ValueError("Only READY selections can be called.")
    if result.contact is None or not result.contact.phone:
        raise ValueError("A READY selection must include a callable Contact.")
    quote, contact = result.quote, result.contact
    if not contact.call_locale:
        raise ValueError("Salesforce Contact.QuoteWake_Call_Locale__c is required for CALL-E calls")
    locale = _validate_locale(contact.call_locale)
    region = _validate_region(quote.account_billing_country_code)
    account_name = _safe_context(quote.account_name, "the customer account")
    contact_name = _safe_context(contact.name, "the quote contact")
    quote_name = _safe_context(quote.quote_name, quote.quote_id)
    currency = _safe_context(quote.currency_code, "currency not specified", maximum=8)
    expiration = format_business_date(quote.expiration_date, regional_settings) if regional_settings is not None and quote.expiration_date else quote.expiration_date.isoformat() if quote.expiration_date else "not set"
    line_context = _line_context(lines, quote.currency_code, regional_settings=regional_settings)
    total = format_money(quote.money or quote.amount, quote.currency_code, regional_settings=regional_settings) if regional_settings is not None else f"{currency} {_decimal_text(quote.amount)}"
    task = prompt_settings.render(
        {
            "locale": locale,
            "region": region,
            "contact_name": contact_name,
            "account_name": account_name,
            "quote_name": quote_name,
            "quote_total": total,
            "expiration_date": expiration,
            "attempt_count": quote.attempt_count,
            "quote_items": line_context,
        },
        phone=contact.phone,
    )
    return CallRequest(
        quote.quote_id,
        quote.opportunity_id,
        contact.contact_id,
        contact.phone,
        task,
        locale,
        region,
    )
