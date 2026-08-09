"""Validated TOML configuration for QuoteWake Salesforce."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import math
from pathlib import Path
import re
import tomllib
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from babel import Locale
from babel.core import UnknownLocaleError

from quotewake_salesforce.domain.policy import InitialFollowUpTiming


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "quotewake.toml"


@dataclass(frozen=True)
class RegionalSettings:
    """Business calendar and presentation settings, independent of host locale.

    Babel uses its underscore-based CLDR identifiers internally.  QuoteWake
    accepts both those identifiers (for example ``en_US``) and BCP-47 tags
    (for example ``en-US``).  Babel currently cannot parse BCP-47 Unicode
    extensions such as ``en-US-u-nu-latn``; the base locale is used in that
    case because Babel's formatters do not expose those extensions reliably.
    """

    business_timezone: ZoneInfo
    locale: str

    @classmethod
    def from_values(cls, business_timezone: str, locale: str) -> "RegionalSettings":
        try:
            timezone_value = ZoneInfo(business_timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown business timezone: {business_timezone}") from exc
        try:
            canonical_locale = _parse_locale(locale)
        except (UnknownLocaleError, ValueError, TypeError) as exc:
            raise ValueError(f"Invalid CLDR locale: {locale}") from exc
        return cls(timezone_value, canonical_locale)


def _parse_locale(value: str) -> str:
    """Parse a Babel/CLDR or BCP-47 locale and return Babel's canonical form."""

    if not isinstance(value, str) or not value.strip():
        raise ValueError("locale must be a non-empty string")
    raw = value.strip()
    mixed = "_" in raw and "-" in raw
    parse_value = re.sub(r"[-_]", "_", raw) if mixed else raw
    # Babel accepts the legacy ``@calendar=...`` syntax and discards the
    # extension while returning the base Locale.  Try it first, together with
    # the native BCP-47 separator, before applying the fallback below.
    separator = "-" if "-" in parse_value and "_" not in parse_value else "_"
    try:
        return str(Locale.parse(parse_value, sep=separator))
    except (UnknownLocaleError, ValueError):
        pass

    # Babel 2.x does not accept Unicode ``-u-`` extensions.  They are
    # presentation preferences rather than a timezone or a distinct CLDR
    # locale for QuoteWake, so strip the extension and retain the base tag.
    base = re.split(r"[-_]u[-_]", raw, maxsplit=1, flags=re.IGNORECASE)[0]
    if base == raw:
        raise ValueError(f"unsupported locale identifier: {value}")
    if "_" in base and "-" in base:
        base = re.sub(r"[-_]", "_", base)
    base_separator = "-" if "-" in base and "_" not in base else "_"
    return str(Locale.parse(base, sep=base_separator))


def _number(table: dict[str, Any], key: str) -> float:
    value = table.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"TOML setting selection.initial_follow_up.{key} must be a number.")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"TOML setting selection.initial_follow_up.{key} must be finite.")
    return number


def _load_document(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as handle:
            document = tomllib.load(handle)
    except OSError as exc:
        raise ValueError(f"Cannot read QuoteWake configuration file: {path}") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ValueError(f"Invalid QuoteWake TOML configuration: {path}") from exc
    return document


def load_regional_settings(path: Path) -> RegionalSettings:
    """Load explicit business timezone and CLDR locale."""

    regional = _load_document(path).get("regional")
    if regional is None:
        raise ValueError("QuoteWake configuration requires [regional].")
    if not isinstance(regional, dict):
        raise ValueError("QuoteWake configuration [regional] must be a table.")
    timezone_value = regional.get("business_timezone")
    locale = regional.get("locale")
    if not isinstance(timezone_value, str) or not isinstance(locale, str):
        raise ValueError("QuoteWake configuration requires regional.business_timezone and regional.locale.")
    return RegionalSettings.from_values(timezone_value, locale)


def load_initial_follow_up_timing(path: Path) -> InitialFollowUpTiming:
    """Load and validate the initial follow-up timing policy."""

    document = _load_document(path)

    selection = document.get("selection")
    initial = selection.get("initial_follow_up") if isinstance(selection, dict) else None
    if not isinstance(initial, dict):
        raise ValueError(
            "QuoteWake configuration requires [selection.initial_follow_up]."
        )

    minimum_hours = _number(initial, "minimum_delay_hours")
    standard_hours = _number(initial, "standard_delay_hours")
    due_soon_days = _number(initial, "due_soon_window_days")
    if minimum_hours < 0:
        raise ValueError("minimum_delay_hours cannot be negative.")
    if standard_hours < minimum_hours:
        raise ValueError(
            "standard_delay_hours must be greater than or equal to minimum_delay_hours."
        )
    if due_soon_days < 0:
        raise ValueError("due_soon_window_days cannot be negative.")

    return InitialFollowUpTiming(
        minimum_delay=timedelta(hours=minimum_hours),
        standard_delay=timedelta(hours=standard_hours),
        due_soon_window=timedelta(days=due_soon_days),
    )
