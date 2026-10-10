"""Central configuration for No-Show Guard.

Reads environment variables (optionally from a ``.env`` file via python-dotenv)
and exposes them as typed, validated settings. Keeping all configuration in one
place makes the app easy to set up and easy to demo.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load any .env file found in the project root or current working directory.
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _get_bool(name: str, default: bool = False) -> bool:
    """Parse an env var as a boolean, falling back to ``default``."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_int(name: str, default: int) -> int:
    """Parse an env var as an integer, falling back to ``default`` on error."""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    """Immutable application settings loaded from the environment."""

    # CALL-E API key (read by the official `calle` Python SDK).
    calle_api_key: str = field(
        default_factory=lambda: os.getenv("CALLE_API_KEY", "").strip()
    )

    # Outbound call defaults (region / language).
    region: str = field(default_factory=lambda: os.getenv("CALLE_REGION", "IN").strip())
    locale: str = field(default_factory=lambda: os.getenv("CALLE_LOCALE", "en-US").strip())

    # Scheduling / retry policy.
    confirmation_hours_before: int = field(
        default_factory=lambda: _get_int("CONFIRMATION_HOURS_BEFORE", 24)
    )
    max_retries: int = field(default_factory=lambda: _get_int("MAX_RETRIES", 2))
    retry_hours_apart: int = field(default_factory=lambda: _get_int("RETRY_HOURS_APART", 2))

    # Storage / data paths.
    database_path: str = field(
        default_factory=lambda: os.getenv("DATABASE_PATH", "appointments.db").strip()
    )
    appointments_csv: str = field(
        default_factory=lambda: os.getenv("APPOINTMENTS_CSV", "sample_appointments.csv").strip()
    )

    # Timeouts / polling.
    call_timeout_seconds: int = field(default_factory=lambda: _get_int("CALL_TIMEOUT_SECONDS", 15))
    poll_interval_seconds: int = field(default_factory=lambda: _get_int("POLL_INTERVAL_SECONDS", 5))
    poll_max_seconds: int = field(default_factory=lambda: _get_int("POLL_MAX_SECONDS", 300))

    @property
    def has_api_key(self) -> bool:
        """True when a CALL-E API key has been configured."""
        return bool(self.calle_api_key)

    def validate(self, *, require_key: bool = True) -> None:
        """Raise ``RuntimeError`` if required settings are missing/invalid."""
        if require_key and not self.has_api_key:
            raise RuntimeError(
                "CALLE_API_KEY is not set. Copy .env.example to .env and "
                "paste your CALL-E API key, or export CALLE_API_KEY."
            )
        if self.confirmation_hours_before <= 0:
            raise RuntimeError("CONFIRMATION_HOURS_BEFORE must be a positive integer.")


def get_settings() -> Settings:
    """Build and return the current :class:`Settings`."""
    return Settings()
