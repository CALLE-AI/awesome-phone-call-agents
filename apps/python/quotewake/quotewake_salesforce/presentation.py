"""Locale-aware presentation helpers at the QuoteWake output boundary."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from babel.dates import format_date, format_datetime
from babel.numbers import format_currency, format_decimal

from quotewake_salesforce.config import RegionalSettings
from quotewake_salesforce.domain.models import Money


def format_money(
    value: Decimal | Money | None,
    currency: str | None = None,
    *,
    regional_settings: RegionalSettings | None = None,
) -> str:
    """Render exact money using the configured CLDR locale.

    When no regional settings are supplied the helper intentionally retains a
    plain, deterministic representation for backwards-compatible unit callers;
    application output always passes its loaded regional settings.
    """

    scale: int | None = None
    if isinstance(value, Money):
        currency = value.currency
        decimal_value = value.value
        scale = value.scale
    else:
        decimal_value = value
    if decimal_value is None:
        return "amount unavailable"
    if scale is not None:
        decimal_value = decimal_value.quantize(Decimal(1).scaleb(-scale))
    if regional_settings is None:
        return f"{currency + ' ' if currency else ''}{decimal_value:f}"
    if currency:
        return format_currency(
            decimal_value,
            currency,
            locale=regional_settings.locale,
            currency_digits=False,
        )
    return format_decimal(decimal_value, locale=regional_settings.locale)


def format_business_date(value: date | None, regional_settings: RegionalSettings) -> str:
    if value is None:
        return "not set"
    return format_date(value, format="long", locale=regional_settings.locale)


def format_business_datetime(value: datetime | None, regional_settings: RegionalSettings) -> str:
    if value is None:
        return "not set"
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("DateTime must be timezone-aware before locale formatting.")
    return format_datetime(
        value.astimezone(regional_settings.business_timezone),
        format="medium",
        locale=regional_settings.locale,
        tzinfo=regional_settings.business_timezone,
    )


def money_record(money: Money | None) -> dict[str, Any] | None:
    """Serialize exact money without converting its Decimal to a float."""

    if money is None:
        return None
    exact_value = money.value.quantize(Decimal(1).scaleb(-money.scale))
    return {
        "value": format(exact_value, "f"),
        "currency": money.currency,
        "source": money.source,
        "scale": money.scale,
    }
