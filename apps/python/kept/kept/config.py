"""Operator-owned settings. Defaults are the cautious end of every choice."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from kept.models import is_e164

OFFICIAL_BASE_URL = "https://api.heycall-e.com"
"""The only origin a production CALL-E credential is ever sent to."""

DEFAULT_BASE_URL = OFFICIAL_BASE_URL

AUTHORIZED_RECIPIENTS_FILE = "authorized_recipients.txt"


@dataclass(frozen=True, slots=True)
class Policy:
    """Rules that decide who may be called, and when a word becomes a record."""

    grace_days_after_due: int = 3
    quiet_hours_start: int = 20
    quiet_hours_end: int = 9
    min_days_between_calls: int = 7
    promise_grace_days: int = 2
    min_confidence_to_record: float = 0.7
    max_promise_horizon_days: int = 45
    max_calls_per_run: int = 5

    def __post_init__(self) -> None:
        if not 0 <= self.quiet_hours_start <= 23 or not 0 <= self.quiet_hours_end <= 23:
            raise ValueError("Quiet hours must be hours of a day.")
        if not 0.0 <= self.min_confidence_to_record <= 1.0:
            raise ValueError("min_confidence_to_record must be between 0 and 1.")
        if self.max_calls_per_run < 0:
            raise ValueError("max_calls_per_run cannot be negative.")


@dataclass(frozen=True, slots=True)
class Organisation:
    """Who the call is made on behalf of. Read out in full on every call."""

    name: str
    callback_number: str
    agent_name: str = "an automated assistant"

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("Organisation name is required; calls must identify the creditor.")
        if not is_e164(self.callback_number):
            raise ValueError(
                "Organisation callback_number must be E.164: + followed by 7 to 15 digits. "
                "It is read out to strangers, so an undialable number is worse than none."
            )


@dataclass(frozen=True, slots=True)
class Credentials:
    api_key: str
    base_url: str = DEFAULT_BASE_URL


class MissingCredentialsError(RuntimeError):
    """Raised when a live run is requested without an API key."""


class UntrustedBaseUrlError(RuntimeError):
    """Raised when CALLE_BASE_URL points anywhere but the official CALL-E API."""


class UnauthorizedRecipientsError(RuntimeError):
    """Raised when a live run has no per-recipient authorization file to read."""


def load_credentials(environ: dict[str, str] | None = None) -> Credentials:
    source = os.environ if environ is None else environ
    api_key = source.get("CALLE_API_KEY", "").strip()
    if not api_key:
        raise MissingCredentialsError(
            "CALLE_API_KEY is not set. Live calls are refused without it; "
            "run with --simulate to exercise the same code path for free."
        )
    return Credentials(api_key=api_key, base_url=_official_base_url(source))


def _official_base_url(source: dict[str, str]) -> str:
    """Pin the origin before a production key is attached to a request.

    An overridable base URL turns one environment variable into credential
    exfiltration, so the override is kept for parity with the SDK but is only
    allowed to name the official API. The simulator never comes through here.
    """
    configured = source.get("CALLE_BASE_URL", "").strip().rstrip("/")
    if not configured:
        return OFFICIAL_BASE_URL
    if configured != OFFICIAL_BASE_URL:
        raise UntrustedBaseUrlError(
            f"CALLE_BASE_URL is {configured!r}; the API key is only ever sent to "
            f"{OFFICIAL_BASE_URL}. Unset it, or set it to exactly that origin."
        )
    return OFFICIAL_BASE_URL


def load_authorized_recipients(data_dir: Path) -> frozenset[str]:
    """The exact numbers a human has signed off on being dialled from this data set.

    A run confirmation authorises the run, not the destination. Every live call
    is checked against this file, so adding a customer row is never on its own
    enough to make their phone ring.
    """
    path = data_dir / AUTHORIZED_RECIPIENTS_FILE
    if not path.exists():
        raise UnauthorizedRecipientsError(
            f"Missing {path}. Live calling needs one authorized E.164 number per line; "
            "a run confirmation is not authorization for a particular recipient."
        )
    numbers = {
        line.split("#", 1)[0].strip()
        for line in path.read_text(encoding="utf-8").splitlines()
    }
    authorized = {number for number in numbers if number}
    invalid = sorted(number for number in authorized if not is_e164(number))
    if invalid:
        raise UnauthorizedRecipientsError(
            f"{path} lists {len(invalid)} entr{'y' if len(invalid) == 1 else 'ies'} "
            "that are not E.164; authorization must name an exact dialable number."
        )
    if not authorized:
        raise UnauthorizedRecipientsError(
            f"{path} authorises nobody. Live calling is refused with an empty allow list."
        )
    return frozenset(authorized)
