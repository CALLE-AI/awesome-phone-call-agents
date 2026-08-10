"""Validated TOML configuration for QuoteWake Salesforce."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time, timedelta
import math
from pathlib import Path
import re
import tomllib
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from babel import Locale
from babel.core import UnknownLocaleError

from quotewake_salesforce.domain.policy import (
    CallingHoursPolicy,
    CooldownPolicy,
    FollowUpPolicies,
    InitialFollowUpTiming,
    RetryPolicy,
    normalize_outcome,
    weekdays_from_names,
)


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "quotewake.toml"


@dataclass(frozen=True)
class LoggingSettings:
    """Structured application logging settings loaded from QuoteWake TOML."""

    directory: str = "logs"
    format: str = "text"
    level: str = "INFO"
    max_bytes: int = 5 * 1024 * 1024
    backup_count: int = 5


def _logging_string(
    table: dict[str, Any], key: str, default: str, *, choices: set[str] | None = None
) -> str:
    value = table.get(key, default)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"TOML setting logging.{key} must be a non-empty string.")
    normalized = value.strip()
    if choices is not None and normalized.upper() not in choices:
        allowed = ", ".join(sorted(choices))
        raise ValueError(f"TOML setting logging.{key} must be one of: {allowed}.")
    return normalized


def _logging_integer(table: dict[str, Any], key: str, default: int, *, minimum: int) -> int:
    value = table.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"TOML setting logging.{key} must be an integer.")
    if value < minimum:
        comparison = "greater than zero" if minimum == 1 else f"at least {minimum}"
        raise ValueError(f"TOML setting logging.{key} must be {comparison}.")
    return value


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


def load_logging_settings(path: Path) -> LoggingSettings:
    """Load and validate structured logging settings.

    Relative directories are resolved against the QuoteWake application root
    by :func:`quotewake_salesforce.structured_logging.configure_logging`.
    Omitting ``[logging]`` keeps the production-safe defaults.
    """

    logging_table = _load_document(path).get("logging", {})
    if not isinstance(logging_table, dict):
        raise ValueError("QuoteWake configuration [logging] must be a table.")

    directory = _logging_string(logging_table, "directory", "logs")
    log_format = _logging_string(logging_table, "format", "text", choices={"TEXT"})
    level = _logging_string(
        logging_table,
        "level",
        "INFO",
        choices={"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"},
    )
    max_bytes = _logging_integer(logging_table, "max_bytes", 5 * 1024 * 1024, minimum=1)
    backup_count = _logging_integer(logging_table, "backup_count", 5, minimum=0)
    return LoggingSettings(
        directory=directory,
        format=log_format.lower(),
        level=level.upper(),
        max_bytes=max_bytes,
        backup_count=backup_count,
    )


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


def _required_table(document: dict[str, Any], dotted_name: str) -> dict[str, Any]:
    """Return a required TOML table with a useful validation error."""

    current: Any = document
    for part in dotted_name.split("."):
        if not isinstance(current, dict) or part not in current:
            raise ValueError(f"QuoteWake configuration requires [{dotted_name}].")
        current = current[part]
    if not isinstance(current, dict):
        raise ValueError(f"QuoteWake configuration [{dotted_name}] must be a table.")
    return current


def _required_bool(table: dict[str, Any], key: str, section: str) -> bool:
    value = table.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"TOML setting {section}.{key} must be a boolean.")
    return value


def _required_number(table: dict[str, Any], key: str, section: str) -> float:
    value = table.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"TOML setting {section}.{key} must be a number.")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"TOML setting {section}.{key} must be finite.")
    return result


def _required_string_list(table: dict[str, Any], key: str, section: str) -> list[str]:
    value = table.get(key)
    if not isinstance(value, list) or not value or not all(
        isinstance(item, str) and item.strip() for item in value
    ):
        raise ValueError(f"TOML setting {section}.{key} must be a non-empty list of strings.")
    return [item.strip() for item in value]


def _required_time(table: dict[str, Any], key: str, section: str) -> time:
    value = table.get(key)
    if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError(f"TOML setting {section}.{key} must use HH:MM (24-hour) format.")
    hour, minute = (int(part) for part in value.split(":"))
    return time(hour, minute)


def load_follow_up_policies(path: Path, regional_settings: RegionalSettings) -> FollowUpPolicies:
    """Load the mandatory retry, cooldown, and calling-hours policy tables."""

    document = _load_document(path)
    retry_table = _required_table(document, "follow_up.retry")
    cooldown_table = _required_table(document, "follow_up.cooldown")
    hours_table = _required_table(document, "follow_up.calling_hours")

    max_attempts_value = retry_table.get("max_attempts")
    if isinstance(max_attempts_value, bool) or not isinstance(max_attempts_value, int):
        raise ValueError("TOML setting follow_up.retry.max_attempts must be an integer.")
    if max_attempts_value < 1:
        raise ValueError("TOML setting follow_up.retry.max_attempts must be at least 1.")

    delay_values = retry_table.get("retry_delays_days")
    if not isinstance(delay_values, list) or len(delay_values) != max_attempts_value - 1:
        raise ValueError(
            "TOML setting follow_up.retry.retry_delays_days must contain exactly "
            "max_attempts - 1 values."
        )
    delays: list[timedelta] = []
    for index, value in enumerate(delay_values):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(
                f"TOML setting follow_up.retry.retry_delays_days[{index}] must be a number."
            )
        if not math.isfinite(float(value)) or float(value) < 0:
            raise ValueError(
                f"TOML setting follow_up.retry.retry_delays_days[{index}] must be finite and non-negative."
            )
        delays.append(timedelta(days=float(value)))

    retry_values = _required_string_list(
        retry_table, "retry_outcomes", "follow_up.retry"
    )
    retry_normalized = [normalize_outcome(value) for value in retry_values]
    if len(set(retry_normalized)) != len(retry_normalized):
        raise ValueError(
            "TOML setting follow_up.retry.retry_outcomes cannot contain normalized duplicates."
        )
    retry_outcomes = frozenset(retry_normalized)
    technical_minutes = _required_number(
        retry_table,
        "technical_failure_retry_delay_minutes",
        "follow_up.retry",
    )
    if technical_minutes < 0:
        raise ValueError(
            "TOML setting follow_up.retry.technical_failure_retry_delay_minutes cannot be negative."
        )
    completed_values = _required_string_list(
        retry_table, "completed_outcomes", "follow_up.retry"
    )
    completed_normalized = [normalize_outcome(item) for item in completed_values]
    if len(set(completed_normalized)) != len(completed_normalized):
        raise ValueError(
            "TOML setting follow_up.retry.completed_outcomes cannot contain normalized duplicates."
        )
    completed_outcomes = frozenset(completed_normalized)
    overlap = retry_outcomes & completed_outcomes
    if overlap:
        raise ValueError(
            "TOML setting follow_up.retry.retry_outcomes and completed_outcomes "
            "cannot overlap: "
            + ", ".join(sorted(overlap))
            + "."
        )
    retry = RetryPolicy(
        max_attempts=max_attempts_value,
        retry_delays=tuple(delays),
        retry_outcomes=retry_outcomes,
        technical_failure_retry_delay=timedelta(minutes=technical_minutes),
        completed_outcomes=completed_outcomes,
    )

    cooldown_enabled = _required_bool(cooldown_table, "enabled", "follow_up.cooldown")
    cooldown_hours = _required_number(
        cooldown_table, "minimum_delay_hours", "follow_up.cooldown"
    )
    if cooldown_hours < 0:
        raise ValueError("TOML setting follow_up.cooldown.minimum_delay_hours cannot be negative.")
    cooldown = CooldownPolicy(cooldown_enabled, timedelta(hours=cooldown_hours))

    calling_enabled = _required_bool(hours_table, "enabled", "follow_up.calling_hours")
    day_names = _required_string_list(hours_table, "days", "follow_up.calling_hours")
    if len({value.lower() for value in day_names}) != len(day_names):
        raise ValueError("TOML setting follow_up.calling_hours.days cannot contain duplicates.")
    start = _required_time(hours_table, "start", "follow_up.calling_hours")
    end = _required_time(hours_table, "end", "follow_up.calling_hours")
    calling_hours = CallingHoursPolicy(
        enabled=calling_enabled,
        days=weekdays_from_names(day_names),
        start=start,
        end=end,
        timezone=regional_settings.business_timezone,
    )
    return FollowUpPolicies(retry=retry, cooldown=cooldown, calling_hours=calling_hours)
