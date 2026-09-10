"""Run configuration.

Fixture mode is the default everywhere. A live call needs three independent signals that
all have to be supplied by a person: `PC_MODE=live`, the CLI flag
`--i-understand-this-places-real-calls`, and an explicit `--max-calls N`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = APP_ROOT / "positive_contact.db"
FIXTURES_DIR = APP_ROOT / "fixtures"

# The only origin live credentials may be sent to.
OFFICIAL_CALLE_BASE_URL = "https://api.heycall-e.com"

LIVE_CONFIRMATION_FLAG = "--i-understand-this-places-real-calls"


class RunMode(str, Enum):
    FIXTURE = "fixture"
    REPLAY = "replay"
    LIVE = "live"


class ConfigError(RuntimeError):
    """Raised when a run is configured in a way that could place an unintended call."""


@dataclass(frozen=True)
class Settings:
    mode: RunMode
    db_path: Path
    api_key: str | None
    base_url: str
    max_calls: int | None
    live_confirmed: bool
    judge_c_enabled: bool
    webhook_url: str | None
    transcript_retention_days: int

    @property
    def places_real_calls(self) -> bool:
        return self.mode is RunMode.LIVE


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def load_settings(
    *,
    mode: str | None = None,
    db_path: Path | None = None,
    max_calls: int | None = None,
    live_confirmed: bool = False,
    env: dict[str, str] | None = None,
) -> Settings:
    """Resolve settings and refuse any live configuration that is missing a gate."""
    environ = dict(os.environ if env is None else env)
    raw_mode = (mode or environ.get("PC_MODE") or RunMode.FIXTURE.value).strip().lower()
    try:
        resolved_mode = RunMode(raw_mode)
    except ValueError as exc:
        allowed = ", ".join(item.value for item in RunMode)
        raise ConfigError(f"unknown mode '{raw_mode}'; expected one of: {allowed}") from exc

    base_url = (environ.get("PC_BASE_URL") or OFFICIAL_CALLE_BASE_URL).rstrip("/")
    api_key = environ.get("CALLE_API_KEY") or None

    if resolved_mode is RunMode.LIVE:
        if not live_confirmed:
            raise ConfigError(
                "live mode requires the explicit confirmation flag "
                f"{LIVE_CONFIRMATION_FLAG}; no call was placed"
            )
        if max_calls is None:
            raise ConfigError(
                "live mode requires an explicit --max-calls N ceiling; no call was placed"
            )
        if max_calls < 1:
            raise ConfigError("--max-calls must be at least 1")
        if not api_key:
            raise ConfigError("live mode requires CALLE_API_KEY in the environment")
        if base_url != OFFICIAL_CALLE_BASE_URL:
            raise ConfigError(
                "live CALL-E credentials may only be sent to the official API origin "
                f"{OFFICIAL_CALLE_BASE_URL}"
            )
    else:
        # A ceiling supplied outside live mode is harmless but must not be silently
        # carried into a later live run, so it is dropped here.
        max_calls = None

    return Settings(
        mode=resolved_mode,
        db_path=Path(db_path) if db_path else Path(environ.get("PC_DB", DEFAULT_DB_PATH)),
        api_key=api_key,
        base_url=base_url,
        max_calls=max_calls,
        live_confirmed=live_confirmed,
        judge_c_enabled=_env_flag("PC_ENABLE_JUDGE_C"),
        webhook_url=environ.get("PC_WEBHOOK_URL") or None,
        transcript_retention_days=int(environ.get("PC_TRANSCRIPT_RETENTION_DAYS", "30")),
    )
