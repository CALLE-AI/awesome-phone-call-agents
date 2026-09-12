"""Runtime configuration, with a production mode that refuses to start unsafely."""

from __future__ import annotations

import hashlib
import secrets
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from callibrate.policy.call_eligibility import parse_allowlist

DEV_SECRET = "development-only-change-me"
DEV_PASSWORD = "callibrate-demo-2026"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CBR_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_path: Path = Path("data/callibrate.db")
    secret_key: str = Field(default=DEV_SECRET, min_length=20)
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    allowed_hosts: str = "localhost,127.0.0.1,testserver"
    forwarded_allow_ips: str = "127.0.0.1"
    https_only: bool = False
    public_base_url: str = "http://localhost:8000"

    # -- Which caller places the call -----------------------------------------
    #: `calle` places real phone calls through CALL-E. `pilot` replays a scripted
    #: conversation through the same evidence pipeline and never dials.
    caller_mode: Literal["pilot", "calle"] = "pilot"

    calle_base_url: str = "https://seleven-mcp-sg.airudder.com"
    calle_channel: str = "openagent_oauth"
    #: Optional explicit bearer token. Left empty, the `calle` CLI token cache is used.
    calle_access_token: str = ""
    calle_cache_root: Path = Path.home() / ".calle-mcp" / "cli"
    calle_first_poll_seconds: float = Field(default=60.0, ge=0, le=600)
    calle_poll_interval_seconds: float = Field(default=8.0, ge=1, le=120)
    calle_max_wait_seconds: float = Field(default=900.0, ge=60, le=7200)
    calle_ttl_seconds: int = Field(default=86_400, ge=600, le=2_592_000)

    # -- Who may be called ----------------------------------------------------
    #: Comma-separated E.164 numbers. A live call to anything else is refused
    #: before a plan is created. Empty means no live call can be placed at all.
    call_allowlist: str = ""
    #: Days an organization is left alone after any call to it. Zero disables
    #: spacing and exists only so a sandbox can be demonstrated repeatedly; it is
    #: refused in production, because a queue with no memory of who it just
    #: phoned will phone the same small charity every morning.
    minimum_call_interval_days: int = Field(default=1, ge=0, le=30)

    # -- Demonstration directory ----------------------------------------------
    bootstrap_sample_data: bool = True
    #: The number the seeded demonstration provider answers on. Set this to a
    #: line you control; it is the only number the live demo will ever ring.
    demo_provider_phone: str = ""
    demo_provider_region: str = "US"
    demo_provider_timezone: str = "America/New_York"

    directory_name: str = "Callibrate Community Directory"
    session_hours: int = Field(default=12, ge=1, le=168)
    login_attempts_per_minute: int = Field(default=8, ge=1, le=100)
    curator_username: str = "judge"
    curator_password: str = DEV_PASSWORD

    @model_validator(mode="after")
    def refuse_unsafe_production(self):
        if self.caller_mode == "calle" and self.environment == "production" and not self.allowlist:
            raise ValueError(
                "CBR_CALL_ALLOWLIST must list the numbers this deployment may call before "
                "CBR_CALLER_MODE=calle is allowed in production"
            )
        if self.environment != "production":
            return self
        errors = []
        if self.secret_key == DEV_SECRET or len(self.secret_key) < 32:
            errors.append("CBR_SECRET_KEY must be a unique value of at least 32 characters")
        if self.curator_password == DEV_PASSWORD or len(self.curator_password) < 14:
            errors.append("CBR_CURATOR_PASSWORD must be changed and contain at least 14 characters")
        if self.caller_mode != "calle":
            errors.append("CBR_CALLER_MODE must be calle")
        if self.minimum_call_interval_days < 1:
            errors.append("CBR_MINIMUM_CALL_INTERVAL_DAYS must be at least 1")
        if self.bootstrap_sample_data:
            errors.append("CBR_BOOTSTRAP_SAMPLE_DATA must be false")
        if not self.https_only:
            errors.append("CBR_HTTPS_ONLY must be true")
        if urlparse(self.public_base_url).scheme != "https":
            errors.append("CBR_PUBLIC_BASE_URL must use https")
        if not self.forwarded_allow_ips.strip():
            errors.append("CBR_FORWARDED_ALLOW_IPS must identify the trusted proxy")
        if {"*", "testserver"}.intersection(self.host_list):
            errors.append("CBR_ALLOWED_HOSTS must contain only deployed hostnames")
        placeholders = [
            name
            for name, value in (
                ("CBR_SECRET_KEY", self.secret_key),
                ("CBR_CURATOR_PASSWORD", self.curator_password),
                ("CBR_CALLE_ACCESS_TOKEN", self.calle_access_token),
            )
            if value and any(marker in value.upper() for marker in ("CHANGE_ME", "REPLACE_ME"))
        ]
        if placeholders:
            errors.append(f"placeholder values must be replaced: {', '.join(placeholders)}")
        if errors:
            raise ValueError("; ".join(errors))
        return self

    @property
    def host_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    @property
    def allowlist(self) -> list[str]:
        return parse_allowlist(self.call_allowlist)

    @property
    def live_calling(self) -> bool:
        return self.caller_mode == "calle"


def password_hash(password: str, *, salt: bytes | None = None) -> str:
    """Return a versioned scrypt hash suitable for storage."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if algorithm != "scrypt" or (n, r, p) != ("16384", "8", "1"):
            return False
        if len(salt) != 32 or len(expected) != 64:
            return False
        actual = hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32
        )
        return secrets.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False
