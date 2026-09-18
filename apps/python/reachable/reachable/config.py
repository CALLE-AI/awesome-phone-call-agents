"""Configuration, and the credential origin allowlist.

Requirement 1 of docs/SAFETY.md: bearer credentials may only ever be sent to an
allowlisted HTTPS provider origin. That is enforced *here*, at startup, before
the API key is ever read from the environment -- so a misconfigured base URL
cannot leak a token, because the process refuses to start.

Matching is on parsed scheme and host, never on substring: a host such as
``api.heycall-e.com.attacker.test`` must not pass.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import time
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

#: The only origin a real CALL-E bearer key may be sent to.
OFFICIAL_CALLE_ORIGIN = "https://api.heycall-e.com"

#: Loopback hosts, permitted only for the local fake server, which never
#: receives a real key.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})

DEFAULT_DB_PATH = "data/reachable.sqlite3"
DEFAULT_DATA_DIR = "sample_data"


#: Where a local .env is looked for, in order. The package directory is included
#: because that is where an operator following the quick start may reasonably put
#: it, and silently ignoring their credentials would be worse than looking twice.
ENV_FILE_LOCATIONS = (
    Path.cwd() / ".env",
    Path(__file__).resolve().parent.parent / ".env",
    Path(__file__).resolve().parent / ".env",
)


def load_env_file(paths: tuple[Path, ...] = ENV_FILE_LOCATIONS) -> Path | None:
    """Load the first ``.env`` found, without overriding the real environment.

    ``override=False`` on purpose: a value exported in the shell is a deliberate
    act for this run, and a stale file should never quietly win over it.

    Returns the file that was loaded, so the CLI can say which one, or None.
    The contents are never logged.

    ``REACHABLE_SKIP_ENV_FILE=1`` disables it entirely. The test suite sets this,
    because a suite that picks up the operator's real credentials is no longer
    testing the thing it claims to test -- and could place a real call.
    """
    if os.environ.get("REACHABLE_SKIP_ENV_FILE", "").strip() == "1":
        return None
    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - python-dotenv is a dependency
        return None
    for path in paths:
        if path.is_file():
            load_dotenv(path, override=False)
            return path
    return None


class ConfigError(ValueError):
    """A configuration value that cannot be safely repaired.

    Never guess a phone number, a region, a timezone, or a credential target.
    Refuse, and say why.
    """


class CredentialOriginError(ConfigError):
    """The configured CALL-E origin is not on the allowlist.

    Raised at startup. This is the credential allowlist from SAFETY.md §1.1.
    """


def _flag(env: Mapping[str, str], name: str) -> bool:
    """Exactly ``"1"`` enables a safety switch; every other value is off.

    Not ``bool(value)``: ``REACHABLE_LIVE_CALLS=0`` and ``=false`` must both mean
    off, and they would not if truthiness decided it.
    """
    return env.get(name, "").strip() == "1"


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


def _float(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number, got {raw!r}") from exc


def parse_clock(raw: str, label: str) -> time:
    """Parse ``HH:MM``. Refuse anything else rather than guessing."""
    try:
        hours, minutes = raw.strip().split(":")
        return time(int(hours), int(minutes))
    except (ValueError, AttributeError) as exc:
        raise ConfigError(f"{label} must be HH:MM, got {raw!r}") from exc


def validate_zone(name: str, label: str = "timezone") -> str:
    """Accept an IANA zone name only.

    Principle 4 of docs/design-principles.md: never infer a timezone from a
    phone number, country code, locale or UTC offset, and do not accept a raw
    offset because it mishandles daylight saving.
    """
    candidate = (name or "").strip()
    if not candidate:
        raise ConfigError(f"{label} is required and must be an IANA name")
    try:
        ZoneInfo(candidate)
    except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
        raise ConfigError(
            f"{label} must be an IANA name such as Europe/London, got {candidate!r}"
        ) from exc
    return candidate


def validate_calle_origin(url: str) -> str:
    """Return the allowlisted origin, or refuse.

    Accepts the official CALL-E origin, or an http/https loopback address for
    the local fake server. Everything else raises.
    """
    candidate = (url or "").strip().rstrip("/")
    if not candidate:
        return OFFICIAL_CALLE_ORIGIN

    parts = urlsplit(candidate)
    if not parts.scheme or not parts.netloc:
        raise CredentialOriginError(
            f"REACHABLE_CALLE_BASE_URL must be an absolute URL, got {candidate!r}"
        )

    # Compare on the parsed host, never on a substring of the whole URL.
    host = (parts.hostname or "").lower()

    if parts.scheme == "https" and host == "api.heycall-e.com":
        return OFFICIAL_CALLE_ORIGIN

    if parts.scheme in {"http", "https"} and host in LOOPBACK_HOSTS:
        return candidate

    raise CredentialOriginError(
        "REACHABLE_CALLE_BASE_URL must be "
        f"{OFFICIAL_CALLE_ORIGIN} or a loopback address for the local fake server; "
        f"refusing {candidate!r}"
    )


@dataclass(frozen=True)
class Config:
    """Runtime configuration. Secrets live here and are never rendered or logged."""

    # Credentials. Read from the environment only.
    calle_api_key: str = ""
    admin_token: str = ""

    # Safety switches. Default off.
    live_calls: bool = False

    # Behaviour.
    trigger_sessions: int = 2
    max_attempts: int = 2
    cascade_limit: int = 4
    confidence_floor: float = 0.6
    transcript_retention_days: int = 14
    calle_timeout_seconds: int = 60
    term_id: str = "current"

    # Local and test.
    calle_base_url: str = OFFICIAL_CALLE_ORIGIN
    data_dir: str = DEFAULT_DATA_DIR
    db_path: str = DEFAULT_DB_PATH

    #: Populated from school.csv at import time, not from the environment: the
    #: calling window and timezone are properties of the school, not of the
    #: deployment. Defaults exist only so previews render before an import.
    school_name: str = "the school"
    school_timezone: str = "Europe/London"
    call_window_start: time = field(default_factory=lambda: time(9, 0))
    call_window_end: time = field(default_factory=lambda: time(16, 0))

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Config":
        """Build config, enforcing the origin allowlist before reading the key."""
        source = os.environ if env is None else env

        # Deliberately first: if this raises, the API key below is never read.
        base_url = validate_calle_origin(source.get("REACHABLE_CALLE_BASE_URL", ""))

        floor = _float(source, "REACHABLE_CONFIDENCE_FLOOR", 0.6)
        if not 0.0 <= floor <= 1.0:
            raise ConfigError("REACHABLE_CONFIDENCE_FLOOR must be between 0 and 1")

        trigger = _int(source, "REACHABLE_TRIGGER_SESSIONS", 2)
        if trigger < 1:
            raise ConfigError("REACHABLE_TRIGGER_SESSIONS must be at least 1")

        return cls(
            calle_api_key=source.get("CALLE_API_KEY", ""),
            admin_token=source.get("REACHABLE_ADMIN_TOKEN", ""),
            live_calls=_flag(source, "REACHABLE_LIVE_CALLS"),
            trigger_sessions=trigger,
            max_attempts=_int(source, "REACHABLE_MAX_ATTEMPTS", 2),
            cascade_limit=_int(source, "REACHABLE_CASCADE_LIMIT", 4),
            confidence_floor=floor,
            transcript_retention_days=_int(source, "REACHABLE_TRANSCRIPT_RETENTION_DAYS", 14),
            calle_timeout_seconds=_int(source, "REACHABLE_CALLE_TIMEOUT_SECONDS", 60),
            term_id=source.get("REACHABLE_TERM_ID", "").strip() or "current",
            calle_base_url=base_url,
            data_dir=source.get("REACHABLE_DATA_DIR", "").strip() or DEFAULT_DATA_DIR,
            db_path=source.get("REACHABLE_DB", "").strip() or DEFAULT_DB_PATH,
        )

    def with_school(
        self, *, name: str, timezone: str, window_start: time, window_end: time
    ) -> "Config":
        """Return a copy carrying the school's own name, zone and calling window."""
        if window_start >= window_end:
            raise ConfigError("call_window_start must be earlier than call_window_end")
        return Config(
            **{
                **self.__dict__,
                "school_name": name,
                "school_timezone": validate_zone(timezone, "school timezone"),
                "call_window_start": window_start,
                "call_window_end": window_end,
            }
        )

    @property
    def zoneinfo(self) -> ZoneInfo:
        return ZoneInfo(self.school_timezone)

    @property
    def uses_fake_calle(self) -> bool:
        return self.calle_base_url != OFFICIAL_CALLE_ORIGIN

    @property
    def mode_banner(self) -> str:
        """DRY-RUN, FAKE or LIVE.

        An operator should never have to work out from context whether the next
        click can ring a real telephone.
        """
        if not self.live_calls:
            return "DRY-RUN"
        if self.uses_fake_calle:
            return "FAKE"
        return "LIVE"

    def redacted(self) -> dict[str, object]:
        """Safe to log or render.

        Secrets become a presence flag, never a prefix: a prefix is still key
        material, and ``sk-abc...`` in a screenshot is a leak.
        """
        return {
            "mode": self.mode_banner,
            "calle_api_key": "set" if self.calle_api_key else "unset",
            "admin_token": "set" if self.admin_token else "unset",
            "calle_base_url": self.calle_base_url,
            "live_calls": self.live_calls,
            "school_name": self.school_name,
            "calling_window": (
                f"{self.call_window_start:%H:%M}-{self.call_window_end:%H:%M} "
                f"{self.school_timezone}"
            ),
            "trigger_sessions": self.trigger_sessions,
            "max_attempts": self.max_attempts,
            "cascade_limit": self.cascade_limit,
            "confidence_floor": self.confidence_floor,
            "data_dir": self.data_dir,
            "db_path": self.db_path,
        }

    def db_file(self) -> Path:
        return Path(self.db_path)
