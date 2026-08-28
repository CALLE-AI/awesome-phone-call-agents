"""Strict, reusable codecs for the Salesforce JSON boundary."""

from __future__ import annotations

import math
import re
import unicodedata
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from .client import SalesforceResponseError


ID_PATTERN = re.compile(r"^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$")
CONTROL_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
DECIMAL_TEXT_PATTERN = re.compile(r"^-?(?:0|[1-9]\d*)(?:\.\d+)?$")


def required(record: dict[str, Any], field_name: str) -> Any:
    """Return a queried field, rejecting Salesforce responses that omit it."""

    if not isinstance(record, dict):
        raise SalesforceResponseError("Salesforce response record is not a JSON object.")
    if field_name not in record:
        raise SalesforceResponseError(f"Salesforce response is missing {field_name}.")
    return record[field_name]


def nullable_datetime(value: Any, field_name: str) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise SalesforceResponseError(f"Salesforce field {field_name} is not a DateTime string.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SalesforceResponseError(f"Salesforce field {field_name} contains an invalid DateTime.") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SalesforceResponseError(f"Salesforce field {field_name} is timezone-naive.")
    return parsed.astimezone(timezone.utc)


def required_datetime(value: Any, field_name: str) -> datetime:
    parsed = nullable_datetime(value, field_name)
    if parsed is None:
        raise SalesforceResponseError(f"Salesforce field {field_name} is unexpectedly empty.")
    return parsed


def nullable_date(value: Any, field_name: str) -> date | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise SalesforceResponseError(f"Salesforce field {field_name} is not a Date string.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise SalesforceResponseError(f"Salesforce field {field_name} contains an invalid Date.") from exc


def nullable_decimal(value: Any, field_name: str, *, precision: int | None = None, scale: int | None = None) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool) or isinstance(value, float):
        raise SalesforceResponseError(f"Salesforce field {field_name} is not an exact decimal value.")
    if not isinstance(value, (str, int, Decimal)):
        raise SalesforceResponseError(f"Salesforce field {field_name} contains an invalid amount.")
    try:
        parsed = Decimal(value)
    except (InvalidOperation, ValueError) as exc:
        raise SalesforceResponseError(f"Salesforce field {field_name} contains an invalid amount.") from exc
    if not parsed.is_finite():
        raise SalesforceResponseError(f"Salesforce field {field_name} must be finite.")
    if isinstance(value, str) and not DECIMAL_TEXT_PATTERN.fullmatch(value):
        raise SalesforceResponseError(f"Salesforce field {field_name} is not a canonical decimal.")
    if scale is not None and -parsed.as_tuple().exponent > scale:
        raise SalesforceResponseError(f"Salesforce field {field_name} exceeds scale {scale}.")
    if precision is not None:
        digits = len(parsed.as_tuple().digits)
        if digits > precision:
            raise SalesforceResponseError(f"Salesforce field {field_name} exceeds precision {precision}.")
    return parsed


def decimal(value: Any, field_name: str, *, precision: int | None = None, scale: int | None = None) -> Decimal:
    """Decode a required exact Salesforce number."""

    parsed = nullable_decimal(value, field_name, precision=precision, scale=scale)
    if parsed is None:
        raise SalesforceResponseError(f"Salesforce field {field_name} is unexpectedly empty.")
    return parsed


def metadata_integer(value: Any, field_name: str) -> int | None:
    """Decode integer schema metadata returned by the Decimal JSON decoder.

    Salesforce JSON numbers are deliberately decoded as
    ``Decimal`` so that monetary values never pass through a binary float.  A
    describe response therefore carries ``precision`` and ``scale`` as
    ``Decimal`` instances too; this boundary converts only exact integral
    metadata values to Python ``int``.
    """

    if value is None:
        return None
    if isinstance(value, bool):
        raise SalesforceResponseError(f"Salesforce metadata {field_name} must be an integer.")
    if isinstance(value, int):
        return value
    if isinstance(value, Decimal) and value.is_finite() and value == value.to_integral_value():
        return int(value)
    raise SalesforceResponseError(f"Salesforce metadata {field_name} must be an integer.")


def non_negative_integer(value: Any, field_name: str, *, precision: int | None = None) -> int:
    if isinstance(value, Decimal) and value.is_finite() and value == value.to_integral_value():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int):
        raise SalesforceResponseError(f"Salesforce field {field_name} must be an integer.")
    if value < 0:
        raise SalesforceResponseError(f"Salesforce field {field_name} cannot be negative.")
    if precision is not None and len(str(value)) > precision:
        raise SalesforceResponseError(f"Salesforce field {field_name} exceeds precision {precision}.")
    return value


def boolean(value: Any, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise SalesforceResponseError(f"Salesforce field {field_name} must be a JSON boolean.")
    return value


def salesforce_id(value: Any, field_name: str, *, prefix: str | None = None) -> str:
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise SalesforceResponseError(f"Salesforce field {field_name} contains an invalid ID.")
    if prefix is not None and not value.startswith(prefix):
        raise SalesforceResponseError(f"Salesforce field {field_name} has an unexpected ID prefix.")
    return value


def nullable_text(value: Any, field_name: str, *, maximum: int | None = None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SalesforceResponseError(f"Salesforce field {field_name} is not text.")
    normalized = unicodedata.normalize("NFC", value)
    if CONTROL_PATTERN.search(normalized):
        raise SalesforceResponseError(f"Salesforce field {field_name} contains control characters.")
    if maximum is not None and len(normalized) > maximum:
        raise SalesforceResponseError(f"Salesforce field {field_name} exceeds {maximum} characters.")
    return normalized


def picklist(value: Any, field_name: str, active_values: set[str] | None = None) -> str | None:
    parsed = nullable_text(value, field_name)
    if parsed is not None and active_values is not None and parsed not in active_values:
        raise SalesforceResponseError(f"Salesforce field {field_name} has an inactive or unknown picklist value.")
    return parsed
